using DbUp.Engine.Output;
using FluentAssertions;
using Npgsql;
using Tempo.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The persistence building blocks (docs/26 sections 7.3 and 7.4) against a
/// migrated PostgreSQL 18, connected as the real runtime roles: the unit of
/// work's RLS settings, and the two directories the tenant filter uses.
/// </summary>
public sealed class PersistenceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string Issuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly Guid userA = Guid.CreateVersion7();
    private readonly Guid tenantA = Guid.CreateVersion7();
    private readonly Guid tenantB = Guid.CreateVersion7();
    private readonly Guid membershipA = Guid.CreateVersion7();

    [Fact]
    public async Task AccountDirectory_FindsTheAccountByIssuerAndSubject()
    {
        var dataSources = await MigrateAndSeedAsync();
        var directory = new AccountDirectory(dataSources);

        var found = await directory.FindByExternalIdentityAsync(Issuer, "sub-a", CancellationToken.None);
        var otherPool = await directory.FindByExternalIdentityAsync("https://other-issuer", "sub-a", CancellationToken.None);

        found.Should().Be(new AccountSnapshot(userA, AccountStatus.Active, EmailVerified: true));
        otherPool.Should().BeNull("the same sub from another pool is another identity");
    }

    [Fact]
    public async Task MembershipDirectory_FindsOnlyTheCallersOwnMembership()
    {
        var dataSources = await MigrateAndSeedAsync();
        var directory = new MembershipDirectory(dataSources);

        var own = await directory.FindAsync(userA, tenantA, CancellationToken.None);
        var other = await directory.FindAsync(userA, tenantB, CancellationToken.None);

        own.Should().BeEquivalentTo(new MembershipSnapshot(membershipA, MembershipRole.Owner, MembershipStatus.Active, OrganizationStatus.Active, SystemRoles.Owner.Permissions));
        other.Should().BeNull();
    }

    [Fact]
    public async Task UnitOfWork_SeesOnlyItsTenant_AndCanMoveToANewOne()
    {
        var dataSources = await MigrateAndSeedAsync();

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userA, tenantA, CancellationToken.None);
        (await CountMembershipsAsync(unitOfWork)).Should().Be(1);

        await unitOfWork.SetTenantAsync(userA, tenantB, CancellationToken.None);
        await using var command = unitOfWork.Command("SELECT organization_id FROM organizations.memberships WHERE organization_id = $1", tenantB);
        (await command.ExecuteScalarAsync()).Should().Be(tenantB, "tenant B's membership is visible once B is the tenant");
    }

    [Fact]
    public async Task UnitOfWork_WithoutCommit_RollsBack()
    {
        var dataSources = await MigrateAndSeedAsync();

        await using (var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userA, tenantA, CancellationToken.None))
        {
            await using var update = unitOfWork.Command("UPDATE organizations.organizations SET display_name = 'changed' WHERE id = $1", tenantA);
            (await update.ExecuteNonQueryAsync()).Should().Be(1);
        }

        await using var check = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userA, tenantA, CancellationToken.None);
        await using var read = check.Command("SELECT display_name FROM organizations.organizations WHERE id = $1", tenantA);
        (await read.ExecuteScalarAsync()).Should().Be("Studio A");
    }

    [Fact]
    public async Task UnitOfWork_SettingsDoNotOutliveTheTransaction()
    {
        var dataSources = await MigrateAndSeedAsync();

        await using (var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userA, tenantA, CancellationToken.None))
        {
            await unitOfWork.CommitAsync(CancellationToken.None);
        }

        // The pool hands back the same physical connection; set_config(..., true)
        // ended with the transaction, so nothing leaks to the next request.
        var dataSource = await dataSources.GetAsync(DatabaseRole.Application, CancellationToken.None);
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("SELECT coalesce(current_setting('app.organization_id', true), '')", connection);
        (await command.ExecuteScalarAsync()).Should().Be(string.Empty);
    }

    [Fact]
    public async Task UnitOfWork_ReplacesPooledConnections_TheServerClosedMeanwhile()
    {
        // On dev (board #347, 2026-10-18 18:59) a Lambda thawed after Neon had suspended its compute, took pooled
        // connections the server had closed, and answered 500 (EndOfStreamException). Here the server closes them.
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var pids = new List<int>();
        var open = new List<UnitOfWork>();
        for (var i = 0; i < 3; i++)
        {
            var unitOfWork = await UnitOfWork.BeginAsync(db, DatabaseRole.Application, null, null, CancellationToken.None);
            await using var pid = unitOfWork.Command("SELECT pg_backend_pid()");
            pids.Add((int)(await pid.ExecuteScalarAsync())!);
            open.Add(unitOfWork);
        }

        foreach (var unitOfWork in open)
        {
            await unitOfWork.DisposeAsync();
        }

        foreach (var pid in pids)
        {
            await db.AsMasterAsync("SELECT pg_terminate_backend($1)", pid);
        }

        await Task.Delay(TimeSpan.FromMilliseconds(300));
        for (var i = 0; i < 3; i++)
        {
            await using var next = await UnitOfWork.BeginAsync(db, DatabaseRole.Application, null, null, CancellationToken.None);
            await using var probe = next.Command("SELECT 1");
            (await probe.ExecuteScalarAsync()).Should().Be(1);
        }
    }

    private static async Task<long> CountMembershipsAsync(UnitOfWork unitOfWork)
    {
        await using var command = unitOfWork.Command("SELECT count(*) FROM organizations.memberships");
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<IDataSourceProvider> MigrateAndSeedAsync()
    {
        var name = await postgres.CreateDatabaseAsync();
        var app = ("tempo_app", Guid.NewGuid().ToString("N"));
        var platform = ("tempo_platform", Guid.NewGuid().ToString("N"));

        await MigrationRunner.RunAsync(
            new DatabaseEndpoint(postgres.Host, postgres.Port, name, SslMode.Disable),
            postgres.Master,
            app,
            platform,
            ("tempo_migrator", Guid.NewGuid().ToString("N")),
            new NullUpgradeLog(),
            CancellationToken.None);

        var userB = Guid.CreateVersion7();
        await using (var connection = postgres.ConnectAsMaster(name))
        {
            await connection.OpenAsync();
            // Positional parameters allow one statement per command.
            var statements = new (string Sql, object[] Values)[]
            {
                ("INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'a@example.com', true, now(), now(), now()), ($2, 'active', 'b@example.com', true, now(), now(), now())", [userA, userB]),
                ("INSERT INTO identity.external_identities (id, user_account_id, issuer, subject, created_at) VALUES ($1, $2, $3, 'sub-a', now())", [Guid.CreateVersion7(), userA, Issuer]),
                ("INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, 'studio-a', 'Studio A', 'active', $2, now(), now()), ($3, 'studio-b', 'Studio B', 'active', $4, now(), now())", [tenantA, userA, tenantB, userB]),
                ("INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'owner', 'active', now(), now()), ($4, $5, $6, 'owner', 'active', now(), now())", [tenantA, membershipA, userA, tenantB, Guid.CreateVersion7(), userB]),
                ("INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())", [tenantA, Guid.CreateVersion7(), membershipA, SystemRoles.Owner.Id])
            };
            foreach (var (sql, values) in statements)
            {
                await using var seed = new NpgsqlCommand(sql, connection);
                foreach (var value in values)
                {
                    seed.Parameters.Add(new NpgsqlParameter { Value = value });
                }

                await seed.ExecuteNonQueryAsync();
            }
        }

        return new ConnectionStringDataSources(postgres, name, app, platform);
    }

    private sealed class ConnectionStringDataSources(
        PostgresFixture postgres,
        string database,
        (string Username, string Password) app,
        (string Username, string Password) platform) : IDataSourceProvider
    {
        private readonly Dictionary<DatabaseRole, NpgsqlDataSource> dataSources = [];

        public ValueTask<NpgsqlDataSource> GetAsync(DatabaseRole role, CancellationToken cancellationToken)
        {
            if (!dataSources.TryGetValue(role, out var dataSource))
            {
                var (username, password) = role == DatabaseRole.Application ? app : platform;
                dataSource = NpgsqlDataSource.Create(new NpgsqlConnectionStringBuilder
                {
                    Host = postgres.Host,
                    Port = postgres.Port,
                    Database = database,
                    Username = username,
                    Password = password,
                    SslMode = SslMode.Disable,
                    MaxPoolSize = 1
                }.ConnectionString);
                dataSources[role] = dataSource;
            }

            return ValueTask.FromResult(dataSource);
        }
    }
}
