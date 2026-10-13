using DbUp;
using DbUp.Engine.Output;
using Npgsql;

namespace Tempo.DatabaseMigrator;

/// <summary>
/// Where the migrator connects. SSL is required by default; only the local
/// CLI entry point (Program.cs) may turn it off, for the docker-compose
/// PostgreSQL that runs without TLS.
/// </summary>
public sealed record DatabaseEndpoint(string Host, int Port, string DatabaseName, SslMode SslMode = SslMode.Require);

public sealed record MigrationResult(bool Successful, string[] AppliedScripts);

/// <summary>
/// Runs role bootstrap followed by the DbUp-managed schema migration
/// (LLD section 11). Migrations are never run at API/Worker startup - this
/// is invoked only as an explicit deployment step (see Function.cs) or
/// locally via Program.cs.
/// </summary>
public static class MigrationRunner
{
    public static async Task<MigrationResult> RunAsync(
        DatabaseEndpoint endpoint,
        (string Username, string Password) masterCredentials,
        (string Username, string Password) applicationCredentials,
        (string Username, string Password) migratorCredentials,
        IUpgradeLog log,
        CancellationToken cancellationToken)
    {
        var masterConnectionString = BuildConnectionString(endpoint, masterCredentials.Username, masterCredentials.Password);

        await BootstrapRoles.RunAsync(
            masterConnectionString,
            endpoint.DatabaseName,
            applicationCredentials,
            migratorCredentials,
            log,
            cancellationToken);

        var migratorConnectionString = BuildConnectionString(endpoint, migratorCredentials.Username, migratorCredentials.Password);

        var upgrader = DeployChanges.To
            .PostgresqlDatabase(migratorConnectionString)
            .WithScriptsEmbeddedInAssembly(typeof(MigrationRunner).Assembly)
            .JournalTo((connectionManager, upgradeLog) => new MigrationJournal(connectionManager, upgradeLog))
            .WithTransaction()
            .LogTo(log)
            .Build();

        // DbUp's engine is synchronous by design; this method still runs
        // asynchronously up to this point (role bootstrap, secret reads).
        var result = upgrader.PerformUpgrade();

        if (!result.Successful)
        {
            log.LogError(result.Error, "Migration failed after applying {0} script(s)", result.Scripts.Count());
            throw new InvalidOperationException("Database migration failed.", result.Error);
        }

        var appliedScripts = result.Scripts.Select(s => s.Name).ToArray();
        log.LogInformation("Migration succeeded. Applied {0} script(s): {1}", appliedScripts.Length, string.Join(", ", appliedScripts));

        return new MigrationResult(true, appliedScripts);
    }

    private static string BuildConnectionString(DatabaseEndpoint endpoint, string username, string password) =>
        new NpgsqlConnectionStringBuilder
        {
            Host = endpoint.Host,
            Port = endpoint.Port,
            Database = endpoint.DatabaseName,
            Username = username,
            Password = password,
            SslMode = endpoint.SslMode,
            Timeout = 30
        }.ConnectionString;
}
