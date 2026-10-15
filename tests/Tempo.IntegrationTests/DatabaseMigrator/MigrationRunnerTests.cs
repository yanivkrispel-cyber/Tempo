using DbUp.Engine.Output;
using FluentAssertions;
using Npgsql;
using Tempo.DatabaseMigrator;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Runs the real migrator against PostgreSQL 18, the version Neon runs (status page blockers 2 and
/// 3): role bootstrap as the master user, then DbUp as the least-privileged
/// migrator role, with the journal in the migrator-owned `platform` schema.
/// </summary>
public sealed class MigrationRunnerTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static (string Username, string Password) Role(string name) => (name, Guid.NewGuid().ToString("N"));

    private async Task<(DatabaseEndpoint Endpoint, MigrationResult Result)> MigrateFreshDatabaseAsync()
    {
        var database = await postgres.CreateDatabaseAsync();
        var endpoint = new DatabaseEndpoint(postgres.Host, postgres.Port, database, SslMode.Disable);
        var result = await MigrationRunner.RunAsync(
            endpoint, postgres.Master, Role("tempo_app"), Role("tempo_platform"), Role("tempo_migrator"), new NullUpgradeLog(), CancellationToken.None);
        return (endpoint, result);
    }

    [Fact]
    public async Task RunAsync_OnFreshPostgres18_AppliesEveryScriptAndJournalsThemInPlatformSchema()
    {
        var (endpoint, result) = await MigrateFreshDatabaseAsync();

        result.Successful.Should().BeTrue();
        result.AppliedScripts.Should().HaveCount(12);
        result.AppliedScripts[0].Should().EndWith("0001_baseline.sql");
        result.AppliedScripts[1].Should().EndWith("0002_identity_organizations_audit.sql");
        result.AppliedScripts[2].Should().EndWith("0003_join_attempts.sql");
        result.AppliedScripts[3].Should().EndWith("0004_tripwires.sql");
        result.AppliedScripts[4].Should().EndWith("0005_authorization_people.sql");
        result.AppliedScripts[5].Should().EndWith("0006_repair_role_assignments.sql");
        result.AppliedScripts[6].Should().EndWith("0007_account_mfa.sql");
        result.AppliedScripts[7].Should().EndWith("0008_invitation_person.sql");
        result.AppliedScripts[8].Should().EndWith("0009_billing.sql");
        result.AppliedScripts[9].Should().EndWith("0010_scheduling.sql");
        result.AppliedScripts[10].Should().EndWith("0011_moves_messages_retention.sql");
        result.AppliedScripts[11].Should().EndWith("0012_pass_freezes.sql");

        await using var connection = postgres.ConnectAsMaster(endpoint.DatabaseName);
        await connection.OpenAsync();

        (await ScalarAsync<string>(connection, "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'platform'"))
            .Should().Be("tempo_migrator", "the migrator owns the schema that holds its journal");
        (await ScalarAsync<long>(connection, "SELECT count(*) FROM platform.schema_versions"))
            .Should().Be(12);
        (await ScalarAsync<string>(connection, "SELECT to_regclass('public.schemaversions')::text"))
            .Should().BeNull("DbUp's default journal in public is not used");
    }

    [Fact]
    public async Task RunAsync_Twice_SecondRunAppliesNothing()
    {
        var (endpoint, _) = await MigrateFreshDatabaseAsync();

        var second = await MigrationRunner.RunAsync(
            endpoint, postgres.Master, Role("tempo_app"), Role("tempo_platform"), Role("tempo_migrator"), new NullUpgradeLog(), CancellationToken.None);

        second.Successful.Should().BeTrue();
        second.AppliedScripts.Should().BeEmpty();
    }

    [Fact]
    public async Task RunAsync_AsNonSuperuserMaster_BootstrapsAndMigrates()
    {
        // Neon and Aurora hand out a CREATEROLE master, not a superuser. Role
        // names are cluster-wide, so they are unique to this test: roles made
        // by the superuser in other tests would not be this master's to alter.
        var (database, master) = await postgres.CreateManagedMasterDatabaseAsync();
        var suffix = master.Username["tempo_master_".Length..];
        var endpoint = new DatabaseEndpoint(postgres.Host, postgres.Port, database, SslMode.Disable);

        var result = await MigrationRunner.RunAsync(
            endpoint, master, Role($"tempo_app_{suffix}"), Role($"tempo_platform_{suffix}"), Role($"tempo_migrator_{suffix}"), new NullUpgradeLog(), CancellationToken.None);

        result.Successful.Should().BeTrue();
        result.AppliedScripts.Should().HaveCount(12);

        await using var connection = postgres.ConnectAsMaster(database);
        await connection.OpenAsync();
        (await ScalarAsync<string>(connection, "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'platform'"))
            .Should().Be($"tempo_migrator_{suffix}");
    }

    [Fact]
    public async Task RunAsync_RequiringSslAgainstServerWithoutTls_Fails()
    {
        var database = await postgres.CreateDatabaseAsync();
        var endpoint = new DatabaseEndpoint(postgres.Host, postgres.Port, database, SslMode.Require);

        var run = () => MigrationRunner.RunAsync(
            endpoint, postgres.Master, Role("tempo_app"), Role("tempo_platform"), Role("tempo_migrator"), new NullUpgradeLog(), CancellationToken.None);

        // The endpoint's SSL mode reaches the connection: the deployed
        // migrator's Require is honored, not silently downgraded.
        await run.Should().ThrowAsync<NpgsqlException>();
    }

    private static async Task<T?> ScalarAsync<T>(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        var value = await command.ExecuteScalarAsync();
        return value is null or DBNull ? default : (T)value;
    }
}
