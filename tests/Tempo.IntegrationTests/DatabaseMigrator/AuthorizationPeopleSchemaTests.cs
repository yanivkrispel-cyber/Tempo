using FluentAssertions;
using Npgsql;
using Tempo.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Migration 0005 on PostgreSQL 18 (docs/27_Authorization_and_People_LLD.md
/// sections 5 and 11): the backfill from Phase 1 data, the seeded system
/// roles, tenant isolation and the self clause, the append-only consent table
/// and the one-owner rule.
/// </summary>
public sealed class AuthorizationPeopleSchemaTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string InsufficientPrivilege = "42501";
    private const string UniqueViolation = "23505";

    private static readonly Guid OwnerRole = Guid.Parse("00000000-0000-7000-8000-000000000001");
    private static readonly Guid AdminRole = Guid.Parse("00000000-0000-7000-8000-000000000002");
    private static readonly Guid StaffRole = Guid.Parse("00000000-0000-7000-8000-000000000003");
    private static readonly Guid ClientRole = Guid.Parse("00000000-0000-7000-8000-000000000004");

    private static readonly string[] TenantTables =
    [
        "authz.role_assignments", "organizations.ownership_transfers", "people.people", "people.contact_points",
        "people.consents", "people.person_relationships", "people.duplicate_candidates"
    ];

    private readonly Guid ownerUser = Guid.CreateVersion7();
    private readonly Guid clientUser = Guid.CreateVersion7();
    private readonly Guid staffUser = Guid.CreateVersion7();
    private readonly Guid goneUser = Guid.CreateVersion7();
    private readonly Guid clientUserForRepair = Guid.CreateVersion7();
    private readonly Guid tenantA = Guid.CreateVersion7();
    private readonly Guid tenantB = Guid.CreateVersion7();
    private readonly Guid ownerA = Guid.CreateVersion7();
    private readonly Guid clientA = Guid.CreateVersion7();
    private readonly Guid removedA = Guid.CreateVersion7();
    private readonly Guid ownerB = Guid.CreateVersion7();
    private readonly Guid staffB = Guid.CreateVersion7();
    private readonly Guid clientB = Guid.CreateVersion7();

    private sealed record Database(string Name, (string Username, string Password) App, (string Username, string Password) Platform);

    [Fact]
    public async Task Backfill_GivesEveryLiveMembershipOneAssignmentForItsPhaseOneRole()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await using var connection = postgres.ConnectAsMaster(db.Name);
        await connection.OpenAsync();
        var assignments = await RowsAsync(
            connection,
            "SELECT membership_id, role_id FROM authz.role_assignments WHERE status = 'active'",
            reader => (reader.GetGuid(0), reader.GetGuid(1)));

        assignments.Should().BeEquivalentTo(new[]
        {
            (ownerA, OwnerRole), (clientA, ClientRole), (ownerB, OwnerRole), (staffB, StaffRole), (clientB, ClientRole)
        }, "a removed membership gets nothing");
    }

    [Fact]
    public async Task Backfill_GivesEveryLiveMembershipAPersonWithItsVerifiedEmail()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await using var connection = postgres.ConnectAsMaster(db.Name);
        await connection.OpenAsync();
        var people = await RowsAsync(
            connection,
            """
            SELECT p.membership_id, p.source, p.display_name, c.value, c.is_primary, c.verified
            FROM people.people p
            JOIN people.contact_points c ON c.organization_id = p.organization_id AND c.person_id = p.id
            """,
            reader => (reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetBoolean(4), reader.GetBoolean(5)));

        people.Should().BeEquivalentTo(new[]
        {
            (ownerA, "organization_created", "Owner", "owner@example.com", true, true),
            (clientA, "join_link", "client", "client@example.com", true, false),
            (ownerB, "organization_created", "Owner", "owner@example.com", true, true),
            (staffB, "invitation", "Staff", "staff@example.com", true, true),
            (clientB, "join_link", "client", "client@example.com", true, false)
        }, "a missing display name falls back to the email's local part, and the email is lowercased");
    }

    [Fact]
    public async Task SystemRoles_CarryThePhaseOneMatrix()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await using var connection = postgres.ConnectAsMaster(db.Name);
        await connection.OpenAsync();
        var seeded = await RowsAsync(
            connection,
            "SELECT r.key, p.permission_key FROM authz.roles r JOIN authz.role_permissions p ON p.role_id = r.id WHERE r.is_system",
            reader => (reader.GetString(0), reader.GetString(1)));

        // Migrations 0005 and 0010 seed exactly the sets the code evaluates with.
        seeded.Should().BeEquivalentTo(SystemRoles.All.SelectMany(role => role.Permissions.Select(key => (role.Key, key))));
    }

    [Fact]
    public async Task App_CanReadButNotChangeSystemRoles()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await AsAsync(db, db.App, ownerUser, tenantA, async connection =>
        {
            (await CountAsync(connection, "authz.roles")).Should().Be(4);
            (await CountAsync(connection, "authz.role_permissions")).Should().Be(SystemRoles.All.Sum(role => role.Permissions.Count));
            (await ExecuteAsync(connection, "UPDATE authz.roles SET display_name = 'x' WHERE id = $1", OwnerRole)).Should().Be(0);
            (await ExecuteAsync(connection, "DELETE FROM authz.role_permissions WHERE role_id = $1", AdminRole)).Should().Be(0);
        });

        var grant = () => AsAsync(db, db.App, ownerUser, tenantA, connection =>
            ExecuteAsync(connection, "INSERT INTO authz.role_permissions (role_id, permission_key) VALUES ($1, 'roles.manage')", StaffRole));

        (await grant.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task App_WithTenantA_SeesOnlyTenantAPeopleAndAssignments()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await AsAsync(db, db.App, ownerUser, tenantA, async connection =>
        {
            (await CountAsync(connection, "authz.role_assignments")).Should().Be(2 + 1, "tenant A's two, plus the caller's own owner assignment in tenant B");
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM people.people WHERE organization_id = $1", tenantB))
                .Should().Be(1, "only the caller's own record in tenant B (the self clause)");
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM people.contact_points WHERE organization_id = $1", tenantB))
                .Should().Be(0);
            (await ExecuteAsync(connection, "UPDATE people.people SET display_name = 'taken' WHERE organization_id = $1", tenantB))
                .Should().Be(0, "the self clause is for reads only");
        });
    }

    [Fact]
    public async Task App_WithoutAnySetting_SeesNoTenantRows()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await AsAsync(db, db.App, userAccountId: null, organizationId: null, async connection =>
        {
            foreach (var table in TenantTables)
            {
                (await CountAsync(connection, table)).Should().Be(0, $"{table} fails closed without a tenant");
            }

            (await CountAsync(connection, "authz.roles")).Should().Be(4, "system roles are readable by everyone");
        });
    }

    [Fact]
    public async Task App_OnAnAccountRoute_SeesOwnAssignmentsAndPeopleInEveryStudio()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await AsAsync(db, db.App, clientUser, organizationId: null, async connection =>
        {
            (await RowsAsync(connection, "SELECT membership_id FROM authz.role_assignments", reader => reader.GetGuid(0)))
                .Should().BeEquivalentTo(new[] { clientA, clientB });
            (await RowsAsync(connection, "SELECT membership_id FROM people.people", reader => reader.GetGuid(0)))
                .Should().BeEquivalentTo(new[] { clientA, clientB });
        });
    }

    [Theory]
    [InlineData("UPDATE people.consents SET state = 'granted'")]
    [InlineData("DELETE FROM people.consents")]
    public async Task App_CannotRewriteConsentHistory(string sql)
    {
        var db = await MigrateWithPhaseOneDataAsync();

        var rewrite = () => AsAsync(db, db.App, ownerUser, tenantA, connection => ExecuteAsync(connection, sql));

        (await rewrite.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task App_CanRecordConsentInItsTenant()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await AsAsync(db, db.App, clientUser, tenantA, async connection =>
        {
            var person = await ScalarAsync<Guid>(connection, "SELECT id FROM people.people WHERE membership_id = $1", clientA);
            (await ExecuteAsync(
                connection,
                "INSERT INTO people.consents (organization_id, id, person_id, purpose, channel, state, method, text_version, occurred_at) VALUES ($1, $2, $3, 'marketing', 'email', 'granted', 'self', 'v1', now())",
                tenantA,
                Guid.CreateVersion7(),
                person)).Should().Be(1);
        });
    }

    [Fact]
    public async Task OneOwnerPerStudio_IsEnforcedOnAssignments()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        var secondOwner = () => AsAsync(db, db.App, ownerUser, tenantA, connection =>
            ExecuteAsync(
                connection,
                "INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
                tenantA,
                Guid.CreateVersion7(),
                clientA,
                OwnerRole));

        (await secondOwner.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(UniqueViolation);
    }

    [Fact]
    public async Task Platform_ReadsEveryTenantButCannotEditPeople()
    {
        var db = await MigrateWithPhaseOneDataAsync();

        await AsAsync(db, db.Platform, userAccountId: null, organizationId: null, async connection =>
            (await CountAsync(connection, "people.people")).Should().Be(5));

        var edit = () => AsAsync(db, db.Platform, null, null, connection =>
            ExecuteAsync(connection, "UPDATE people.people SET display_name = 'x'"));

        (await edit.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task Repair0006_GivesAMembershipWithoutAssignmentItsSystemRole()
    {
        var name = await postgres.CreateDatabaseAsync();
        var app = ("tempo_app", Guid.NewGuid().ToString("N"));
        var platform = ("tempo_platform", Guid.NewGuid().ToString("N"));
        var migrator = ("tempo_migrator", Guid.NewGuid().ToString("N"));
        var endpoint = new DatabaseEndpoint(postgres.Host, postgres.Port, name, SslMode.Disable);
        await MigrationRunner.RunAsync(
            endpoint, postgres.Master, app, platform, migrator, new NullUpgradeLog(), CancellationToken.None,
            Before(6));

        await using (var connection = postgres.ConnectAsMaster(name))
        {
            await connection.OpenAsync();
            await ExecuteAsync(connection, "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'late@example.com', true, now(), now(), now())", ownerUser);
            await ExecuteAsync(connection, "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'staff-late@example.com', true, now(), now(), now())", clientUserForRepair);
            await ExecuteAsync(connection, "INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, 'late-studio', 'Late', 'active', $2, now(), now())", tenantA, ownerUser);
            await ExecuteAsync(connection, "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'owner', 'active', now(), now())", tenantA, ownerA, ownerUser);
            await ExecuteAsync(connection, "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'staff', 'active', now(), now())", tenantA, clientA, clientUserForRepair);
            await ExecuteAsync(connection, "INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())", tenantA, Guid.CreateVersion7(), ownerA, OwnerRole);
        }

        await MigrationRunner.RunAsync(endpoint, postgres.Master, app, platform, migrator, new NullUpgradeLog(), CancellationToken.None);

        await using var check = postgres.ConnectAsMaster(name);
        await check.OpenAsync();
        var assignments = await RowsAsync(
            check,
            "SELECT membership_id, role_id FROM authz.role_assignments WHERE status = 'active'",
            reader => (reader.GetGuid(0), reader.GetGuid(1)));
        assignments.Should().BeEquivalentTo(new[] { (ownerA, OwnerRole), (clientA, StaffRole) }, "the owner keeps its one assignment and the staff member gets one");
    }

    /// <summary>
    /// Migrates to 0004, seeds Phase 1 data the way the API wrote it, then runs
    /// 0005 so its backfill sees real rows. Tenant A: an owner, a client who
    /// joined by link and a removed member. Tenant B: the same owner account,
    /// a staff member who accepted an invitation, and the same client.
    /// </summary>
    private async Task<Database> MigrateWithPhaseOneDataAsync()
    {
        var name = await postgres.CreateDatabaseAsync();
        var app = ("tempo_app", Guid.NewGuid().ToString("N"));
        var platform = ("tempo_platform", Guid.NewGuid().ToString("N"));
        var migrator = ("tempo_migrator", Guid.NewGuid().ToString("N"));
        var endpoint = new DatabaseEndpoint(postgres.Host, postgres.Port, name, SslMode.Disable);

        await MigrationRunner.RunAsync(
            endpoint, postgres.Master, app, platform, migrator, new NullUpgradeLog(), CancellationToken.None,
            Before(5));

        await using (var connection = postgres.ConnectAsMaster(name))
        {
            await connection.OpenAsync();
            foreach (var (user, email, displayName, verified) in new[]
            {
                (ownerUser, "Owner@Example.com", (object)"Owner", true),
                (clientUser, "client@example.com", DBNull.Value, false),
                (staffUser, "staff@example.com", "Staff", true),
                (goneUser, "gone@example.com", "Gone", true)
            })
            {
                await ExecuteAsync(
                    connection,
                    "INSERT INTO identity.user_accounts (id, status, email, email_verified, display_name, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, $3, $4, now(), now(), now())",
                    user, email, verified, displayName);
            }

            foreach (var (tenant, slug) in new[] { (tenantA, "studio-a"), (tenantB, "studio-b") })
            {
                await ExecuteAsync(
                    connection,
                    "INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, 'active', $3, now(), now())",
                    tenant, slug, ownerUser);
            }

            foreach (var (tenant, membership, user, role, status) in new[]
            {
                (tenantA, ownerA, ownerUser, "owner", "active"),
                (tenantA, clientA, clientUser, "client", "active"),
                (tenantA, removedA, goneUser, "staff", "removed"),
                (tenantB, ownerB, ownerUser, "owner", "active"),
                (tenantB, staffB, staffUser, "staff", "active"),
                (tenantB, clientB, clientUser, "client", "suspended")
            })
            {
                await ExecuteAsync(
                    connection,
                    "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())",
                    tenant, membership, user, role, status);
            }

            await ExecuteAsync(
                connection,
                "INSERT INTO organizations.invitations (organization_id, id, email, role, token_hash, status, expires_at, invited_by_membership_id, accepted_membership_id, created_at, updated_at) VALUES ($1, $2, 'staff@example.com', 'staff', $3, 'accepted', now(), $4, $5, now(), now())",
                tenantB, Guid.CreateVersion7(), new byte[] { 7, 7, 7 }, ownerB, staffB);
        }

        await MigrationRunner.RunAsync(endpoint, postgres.Master, app, platform, migrator, new NullUpgradeLog(), CancellationToken.None);

        return new Database(name, app, platform);
    }

    /// <summary>Keeps the scripts numbered below <paramref name="number"/>, e.g. Before(5) stops after 0004.</summary>
    private static Func<string, bool> Before(int number) =>
        script =>
        {
            var file = script.Split('.')[^2];
            return int.Parse(file[..4], System.Globalization.CultureInfo.InvariantCulture) < number;
        };

    /// <summary>One transaction as the given runtime role, with the two RLS settings, as the API runs.</summary>
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

    private static async Task<List<T>> RowsAsync<T>(NpgsqlConnection connection, string sql, Func<NpgsqlDataReader, T> read)
    {
        await using var command = Command(connection, sql, []);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<T>();
        while (await reader.ReadAsync())
        {
            rows.Add(read(reader));
        }

        return rows;
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
