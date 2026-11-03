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
/// lookups that run before a tenant is known. Migration 0040 (#561, SR-10):
/// row-level security on the account and sign-in tables, the column list the
/// app role may update and the two account lookups.
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

    private static readonly string[] AccountTables = ["identity.user_accounts", "identity.external_identities"];

    private const string Issuer = "https://issuer.example";

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

    [Fact]
    public async Task App_WithoutAnAccount_SeesNoAccountsOrSignInLinks()
    {
        var db = await MigrateAndSeedAsync();

        foreach (var tenant in new Guid?[] { null, tenantA })
        {
            await AsAsync(db, db.App, userAccountId: null, tenant, async connection =>
            {
                foreach (var table in AccountTables)
                {
                    (await CountAsync(connection, table)).Should().Be(0, $"{table} fails closed without an account, even inside a tenant");
                }
            });
        }
    }

    [Fact]
    public async Task App_AsAnAccount_SeesOnlyItsOwnAccountAndSignInLink()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, tenantA, async connection =>
        {
            (await CountAsync(connection, "identity.user_accounts")).Should().Be(1);
            (await ScalarAsync<Guid>(connection, "SELECT id FROM identity.user_accounts")).Should().Be(userA);
            (await CountAsync(connection, "identity.external_identities")).Should().Be(1);
            (await ScalarAsync<Guid>(connection, "SELECT user_account_id FROM identity.external_identities")).Should().Be(userA);
        });
    }

    [Fact]
    public async Task App_AsAnAccount_ChangesOnlyItsOwnRowAndOnlyTheAllowedColumns()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userA, organizationId: null, async connection =>
        {
            (await ExecuteAsync(connection, "UPDATE identity.user_accounts SET display_name = 'taken', version = version + 1 WHERE id = $1", userB))
                .Should().Be(0, "another account's row is invisible, so the update matches nothing");
            (await ExecuteAsync(connection, "DELETE FROM identity.user_accounts WHERE id = $1", userB)).Should().Be(0);
            (await ExecuteAsync(
                connection,
                "UPDATE identity.user_accounts SET display_name = 'A', locale = 'en-US', email = 'a2@example.com', email_verified = true, mfa_enabled = true, identity_synced_at = now(), updated_at = now(), version = version + 1 WHERE id = $1",
                userA)).Should().Be(1, "these are the columns AccountService updates");
        });

        foreach (var sql in new[]
        {
            "UPDATE identity.user_accounts SET status = 'active'",
            "UPDATE identity.user_accounts SET id = id",
            "UPDATE identity.external_identities SET user_account_id = user_account_id",
            "DELETE FROM identity.external_identities"
        })
        {
            var write = () => AsAsync(db, db.App, userA, null, connection => ExecuteAsync(connection, sql));
            (await write.Should().ThrowAsync<PostgresException>($"{sql} has no grant")).Which.SqlState.Should().Be(InsufficientPrivilege);
        }

        var linkToAnother = () => AsAsync(db, db.App, userA, null, connection => ExecuteAsync(
            connection,
            "INSERT INTO identity.external_identities (id, user_account_id, issuer, subject, created_at) VALUES ($1, $2, $3, 'sub-x', now())",
            Guid.CreateVersion7(),
            userB,
            Issuer));
        (await linkToAnother.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);

        var createAnother = () => AsAsync(db, db.App, userA, null, connection => ExecuteAsync(
            connection,
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'c@example.com', true, now(), now(), now())",
            Guid.CreateVersion7()));
        (await createAnother.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);

        await using var master = postgres.ConnectAsMaster(db.Name);
        await master.OpenAsync();
        (await ScalarAsync<string>(master, "SELECT coalesce(display_name, '') FROM identity.user_accounts WHERE id = $1", userB)).Should().BeEmpty();
        (await ScalarAsync<long>(master, "SELECT count(*) FROM identity.external_identities")).Should().Be(2);
    }

    [Fact]
    public async Task AccountLookup_FindsTheAccountBySignInBeforeItsIdIsKnown()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.App, userAccountId: null, organizationId: null, async connection =>
        {
            (await ScalarAsync<Guid>(connection, "SELECT id FROM identity.find_account_by_external_identity($1, 'sub-b')", Issuer))
                .Should().Be(userB);
            (await ScalarAsync<string>(connection, "SELECT email FROM identity.find_account_by_external_identity($1, 'sub-b')", Issuer))
                .Should().Be("b@example.com");
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM identity.find_account_by_external_identity($1, 'sub-unknown')", Issuer))
                .Should().Be(0);
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM identity.find_account_by_external_identity('https://other.example', 'sub-b')"))
                .Should().Be(0, "the issuer is part of the key");
        });
    }

    [Fact]
    public async Task ProfileLookup_ReturnsTheCallerAndMembersOfTheCurrentStudioOnly()
    {
        var db = await MigrateAndSeedAsync();
        var userC = Guid.CreateVersion7();
        await using (var master = postgres.ConnectAsMaster(db.Name))
        {
            await master.OpenAsync();
            await ExecuteAsync(
                master,
                "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'c@example.com', true, now(), now(), now())",
                userC);

            // C left studio A (removed members keep their names in its audit log); A is also a client of studio B,
            // so A and B share a studio, but not studio A.
            foreach (var (tenant, user, status) in new[] { (tenantA, userC, "removed"), (tenantB, userA, "active") })
            {
                await ExecuteAsync(
                    master,
                    "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', $4, now(), now())",
                    tenant,
                    Guid.CreateVersion7(),
                    user,
                    status);
            }
        }

        var everyone = new[] { userA, userB, userC };
        async Task<Guid[]> ProfilesAsync(Guid? caller, Guid? tenant)
        {
            Guid[] found = [];
            await AsAsync(db, db.App, caller, tenant, async connection =>
                found = await ScalarAsync<Guid[]>(connection, "SELECT coalesce(array_agg(id ORDER BY email), '{}') FROM identity.find_account_profiles($1)", everyone));
            return found;
        }

        (await ProfilesAsync(userA, tenantA)).Should().Equal(userA, userC);
        (await ProfilesAsync(userA, tenantB)).Should().Equal(userA, userB);
        (await ProfilesAsync(userA, null)).Should().Equal(userA);
        (await ProfilesAsync(null, null)).Should().BeEmpty();
    }

    [Fact]
    public async Task Platform_ReadsEveryAccountButNoSignInLinksAndChangesNoAccount()
    {
        var db = await MigrateAndSeedAsync();

        await AsAsync(db, db.Platform, userAccountId: null, organizationId: null, async connection =>
            (await CountAsync(connection, "identity.user_accounts")).Should().Be(2, "the operator console shows owners' emails and counts accounts"));

        foreach (var sql in new[]
        {
            "SELECT count(*) FROM identity.external_identities",
            "UPDATE identity.user_accounts SET display_name = 'x'",
            "SELECT * FROM identity.find_account_profiles('{}')"
        })
        {
            var run = () => AsAsync(db, db.Platform, null, null, connection => ExecuteAsync(connection, sql));
            (await run.Should().ThrowAsync<PostgresException>($"{sql} is not the platform role's")).Which.SqlState.Should().Be(InsufficientPrivilege);
        }
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
        foreach (var (user, email, subject) in new[] { (userA, "a@example.com", "sub-a"), (userB, "b@example.com", "sub-b") })
        {
            await ExecuteAsync(
                connection,
                "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
                user,
                email);
            await ExecuteAsync(
                connection,
                "INSERT INTO identity.external_identities (id, user_account_id, issuer, subject, created_at) VALUES ($1, $2, $3, $4, now())",
                Guid.CreateVersion7(),
                user,
                Issuer,
                subject);
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
