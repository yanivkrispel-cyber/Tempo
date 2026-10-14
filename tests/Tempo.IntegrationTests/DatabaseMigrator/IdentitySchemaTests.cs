using DbUp.Engine.Output;
using FluentAssertions;
using Npgsql;
using Tempo.DatabaseMigrator;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Migration 0002 on PostgreSQL 18 (docs/26_Identity_Organization_Membership_LLD.md
/// section 13): tenant isolation through row-level security, composite
/// foreign keys, the append-only audit table, the platform role and the two
/// lookups that run before a tenant is known.
/// </summary>
public sealed class IdentitySchemaTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    // PostgreSQL reports both a missing grant and a row-level security
    // violation as insufficient_privilege.
    private const string InsufficientPrivilege = "42501";
    private const string ForeignKeyViolation = "23503";

    private static readonly byte[] InvitationTokenHash = [1, 2, 3, 4];
    private static readonly byte[] JoinCodeHash = [9, 8, 7, 6];
    private static readonly byte[] UnknownHash = [0];
    private static readonly byte[] OtherTokenHash = [5, 5, 5];

    private static readonly string[] TenantTables =
        ["organizations.organizations", "organizations.memberships", "organizations.invitations", "audit.audit_events"];

    private readonly Guid userA = Guid.CreateVersion7();
    private readonly Guid userB = Guid.CreateVersion7();
    private readonly Guid tenantA = Guid.CreateVersion7();
    private readonly Guid tenantB = Guid.CreateVersion7();
    private readonly Guid ownerA = Guid.CreateVersion7();
    private readonly Guid ownerB = Guid.CreateVersion7();

    private sealed record Database(string Name, (string Username, string Password) App, (string Username, string Password) Platform);

    [Fact]
    public async Task App_WithTenantA_SeesOnlyTenantA()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, tenantA, async connection =>
        {
            (await CountAsync(connection, "organizations.organizations")).Should().Be(1);
            (await CountAsync(connection, "organizations.memberships")).Should().Be(1);
            (await CountAsync(connection, "organizations.invitations")).Should().Be(0, "the only invitation belongs to tenant B");
            (await CountAsync(connection, "audit.audit_events")).Should().Be(1);
            (await ScalarAsync<Guid>(connection, "SELECT id FROM organizations.organizations")).Should().Be(tenantA);
        });
    }

    [Fact]
    public async Task App_WithoutAnySetting_SeesNoTenantRows()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userAccountId: null, organizationId: null, async connection =>
        {
            foreach (var table in TenantTables)
            {
                (await CountAsync(connection, table)).Should().Be(0, $"{table} fails closed without a tenant");
            }
        });
    }

    [Fact]
    public async Task App_OnAnAccountRoute_SeesOwnMembershipsAndStudiosOnly()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, organizationId: null, async connection =>
        {
            (await ScalarAsync<Guid>(connection, "SELECT organization_id FROM organizations.memberships")).Should().Be(tenantA);
            (await CountAsync(connection, "organizations.memberships")).Should().Be(1);
            (await CountAsync(connection, "organizations.organizations")).Should().Be(1);
            (await CountAsync(connection, "organizations.invitations")).Should().Be(0);
        });
    }

    [Fact]
    public async Task App_WithTenantA_CannotChangeTenantBRows()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, tenantA, async connection =>
        {
            (await ExecuteAsync(connection, "UPDATE organizations.memberships SET status = 'suspended' WHERE organization_id = $1", tenantB))
                .Should().Be(0);
            (await ExecuteAsync(connection, "DELETE FROM organizations.invitations WHERE organization_id = $1", tenantB))
                .Should().Be(0);
            (await ExecuteAsync(connection, "UPDATE organizations.organizations SET display_name = 'taken' WHERE id = $1", tenantB))
                .Should().Be(0);
        });

        var insert = () => AsAsync(db, db.App, userA, tenantA, connection =>
            ExecuteAsync(
                connection,
                "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'staff', 'active', now(), now())",
                tenantB,
                Guid.CreateVersion7(),
                userA));

        (await insert.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task App_CreatingAStudio_MayOnlyNameItselfAsCreator()
    {
        var db = await MigrateAndSeedAsync();
        var newStudio = Guid.CreateVersion7();
        const string Insert =
            "INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, 'New', 'active', $3, now(), now()) RETURNING id";

        await AsAsync(db, db.App, userA, newStudio, async connection =>
            (await ScalarAsync<Guid>(connection, Insert, newStudio, "new-studio", userA)).Should().Be(newStudio));

        var asSomeoneElse = () => AsAsync(db, db.App, userA, organizationId: null, connection =>
            ScalarAsync<Guid>(connection, Insert, Guid.CreateVersion7(), "other-studio", userB));

        (await asSomeoneElse.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task CompositeForeignKey_RejectsAnInvitationPointingAtAnotherTenantsMembership()
    {
        var db = await MigrateAndSeedAsync();

        await using var connection = postgres.ConnectAsMaster(db.Name);
        await connection.OpenAsync();
        var crossTenant = () => ExecuteAsync(
            connection,
            "INSERT INTO organizations.invitations (organization_id, id, email, role, token_hash, status, expires_at, invited_by_membership_id, created_at, updated_at) VALUES ($1, $2, 'x@example.com', 'staff', $3, 'pending', now() + interval '7 days', $4, now(), now())",
            tenantA,
            Guid.CreateVersion7(),
            OtherTokenHash,
            ownerB);

        (await crossTenant.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(ForeignKeyViolation);
    }

    [Theory]
    [InlineData("UPDATE audit.audit_events SET action = 'rewritten'")]
    [InlineData("DELETE FROM audit.audit_events")]
    public async Task App_CannotRewriteTheAuditTrail(string sql)
    {
        var db = await MigrateAndSeedAsync();

        var rewrite = () => AsAsync(db, db.App, userA, tenantA, connection => ExecuteAsync(connection, sql));

        (await rewrite.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege, "the role has no UPDATE or DELETE grant, so this is refused, not filtered");
    }

    [Fact]
    public async Task App_CanWriteAnAccountLevelAuditEvent()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, organizationId: null, async connection =>
            (await ExecuteAsync(
                connection,
                "INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, correlation_id) VALUES ($1, NULL, now(), 'user', $2, 'account.created', 'user_account', 'c-1')",
                Guid.CreateVersion7(),
                userA)).Should().Be(1));
    }

    [Fact]
    public async Task App_HasNoAccessToPlatformOperators()
    {
        var db = await MigrateAndSeedAsync();

        var read = () => AsAsync(db, db.App, userA, tenantA, connection => CountAsync(connection, "platform_admin.operators"));

        (await read.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task Lookups_FindTheMatchingRowBeforeAnyTenantIsKnown()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, organizationId: null, async connection =>
        {
            (await ScalarAsync<Guid>(connection, "SELECT organization_id FROM organizations.find_invitation_by_token_hash($1)", InvitationTokenHash))
                .Should().Be(tenantB);
            (await ScalarAsync<Guid>(connection, "SELECT id FROM organizations.find_organization_by_join_code_hash($1)", JoinCodeHash))
                .Should().Be(tenantA);
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM organizations.find_invitation_by_token_hash($1)", UnknownHash))
                .Should().Be(0);
        });
    }

    [Fact]
    public async Task Platform_SeesEveryTenantAndMayChangeOnlyStudioStatus()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.Platform, userAccountId: null, organizationId: null, async connection =>
        {
            (await CountAsync(connection, "organizations.organizations")).Should().Be(2);
            (await CountAsync(connection, "organizations.memberships")).Should().Be(2);
            (await CountAsync(connection, "audit.audit_events")).Should().Be(2);
            (await ExecuteAsync(connection, "UPDATE organizations.organizations SET status = 'suspended' WHERE id = $1", tenantB))
                .Should().Be(1);
        });

        var rename = () => AsAsync(db, db.Platform, null, null, connection =>
            ExecuteAsync(connection, "UPDATE organizations.organizations SET display_name = 'renamed' WHERE id = $1", tenantB));

        (await rename.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    private async Task<Database> MigrateAndSeedAsync()
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

        // The container's superuser bypasses row-level security, so it seeds
        // both tenants directly.
        await using var connection = postgres.ConnectAsMaster(name);
        await connection.OpenAsync();
        foreach (var (user, email) in new[] { (userA, "a@example.com"), (userB, "b@example.com") })
        {
            await ExecuteAsync(
                connection,
                "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
                user,
                email);
        }

        foreach (var (tenant, slug, owner, ownerMembership, joinCode) in new[]
        {
            (tenantA, "studio-a", userA, ownerA, (object)JoinCodeHash),
            (tenantB, "studio-b", userB, ownerB, DBNull.Value)
        })
        {
            await ExecuteAsync(
                connection,
                "INSERT INTO organizations.organizations (id, slug, display_name, status, join_code_hash, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, 'active', $3, $4, now(), now())",
                tenant,
                slug,
                joinCode,
                owner);
            await ExecuteAsync(
                connection,
                "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'owner', 'active', now(), now())",
                tenant,
                ownerMembership,
                owner);
            await ExecuteAsync(
                connection,
                "INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, correlation_id) VALUES ($1, $2, now(), 'user', $3, 'organization.created', 'organization', 'seed')",
                Guid.CreateVersion7(),
                tenant,
                owner);
        }

        await ExecuteAsync(
            connection,
            "INSERT INTO organizations.invitations (organization_id, id, email, role, token_hash, status, expires_at, invited_by_membership_id, created_at, updated_at) VALUES ($1, $2, 'staff@example.com', 'staff', $3, 'pending', now() + interval '7 days', $4, now(), now())",
            tenantB,
            Guid.CreateVersion7(),
            InvitationTokenHash,
            ownerB);

        return new Database(name, app, platform);
    }

    /// <summary>
    /// Runs <paramref name="work"/> the way the API will: one transaction, the
    /// two RLS values set with is_local = true, as the given runtime role.
    /// </summary>
    private async Task AsAsync(
        Database db,
        (string Username, string Password) role,
        Guid? userAccountId,
        Guid? organizationId,
        Func<NpgsqlConnection, Task> work)
    {
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = postgres.Host,
            Port = postgres.Port,
            Database = db.Name,
            Username = role.Username,
            Password = role.Password,
            SslMode = SslMode.Disable,
            Pooling = false
        };

        await using var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteAsync(
            connection,
            "SELECT set_config('app.user_account_id', $1, true), set_config('app.organization_id', $2, true)",
            userAccountId?.ToString() ?? string.Empty,
            organizationId?.ToString() ?? string.Empty);
        await work(connection);
        await transaction.CommitAsync();
    }

    private static Task<long> CountAsync(NpgsqlConnection connection, string table) =>
        ScalarAsync<long>(connection, $"SELECT count(*) FROM {table}");

    private static async Task<T> ScalarAsync<T>(NpgsqlConnection connection, string sql, params object[] parameters)
    {
        await using var command = Command(connection, sql, parameters);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    private static async Task<int> ExecuteAsync(NpgsqlConnection connection, string sql, params object[] parameters)
    {
        await using var command = Command(connection, sql, parameters);
        return await command.ExecuteNonQueryAsync();
    }

    private static NpgsqlCommand Command(NpgsqlConnection connection, string sql, object[] parameters)
    {
        var command = new NpgsqlCommand(sql, connection);
        foreach (var value in parameters)
        {
            command.Parameters.Add(new NpgsqlParameter { Value = value });
        }

        return command;
    }
}
