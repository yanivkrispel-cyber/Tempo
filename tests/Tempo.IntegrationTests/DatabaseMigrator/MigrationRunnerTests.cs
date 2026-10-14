using DbUp.Engine.Output;
using FluentAssertions;
using Npgsql;
using Tempo.DatabaseMigrator;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Runs the real migrator against PostgreSQL 17 (status page blockers 2 and
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
            endpoint, postgres.Master, Role("tempo_app"), Role("tempo_migrator"), new NullUpgradeLog(), CancellationToken.None);
        return (endpoint, result);
    }

    [Fact]
    public async Task RunAsync_OnFreshPostgres17_AppliesBaselineAndJournalsItInPlatformSchema()
    {
        var (endpoint, result) = await MigrateFreshDatabaseAsync();

        result.Successful.Should().BeTrue();
        result.AppliedScripts.Should().ContainSingle(name => name.EndsWith("0001_baseline.sql", StringComparison.Ordinal));

        await using var connection = postgres.ConnectAsMaster(endpoint.DatabaseName);
        await connection.OpenAsync();

        (await ScalarAsync<string>(connection, "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'platform'"))
            .Should().Be("tempo_migrator", "the migrator owns the schema that holds its journal");
        (await ScalarAsync<long>(connection, "SELECT count(*) FROM platform.schema_versions"))
            .Should().Be(1);
        (await ScalarAsync<string>(connection, "SELECT to_regclass('public.schemaversions')::text"))
            .Should().BeNull("DbUp's default journal in public is not used");
    }

    [Fact]
    public async Task RunAsync_Twice_SecondRunAppliesNothing()
    {
        var (endpoint, _) = await MigrateFreshDatabaseAsync();

        var second = await MigrationRunner.RunAsync(
            endpoint, postgres.Master, Role("tempo_app"), Role("tempo_migrator"), new NullUpgradeLog(), CancellationToken.None);

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
            endpoint, master, Role($"tempo_app_{suffix}"), Role($"tempo_migrator_{suffix}"), new NullUpgradeLog(), CancellationToken.None);

        result.Successful.Should().BeTrue();
        result.AppliedScripts.Should().ContainSingle(name => name.EndsWith("0001_baseline.sql", StringComparison.Ordinal));

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
            endpoint, postgres.Master, Role("tempo_app"), Role("tempo_migrator"), new NullUpgradeLog(), CancellationToken.None);

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

    private sealed class NullUpgradeLog : IUpgradeLog
    {
        public void LogTrace(string format, params object[] args) { }

        public void LogDebug(string format, params object[] args) { }

        public void LogInformation(string format, params object[] args) { }

        public void LogWarning(string format, params object[] args) { }

        public void LogError(string format, params object[] args) { }

        public void LogError(Exception ex, string format, params object[] args) { }
    }
}
