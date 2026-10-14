using Serilog;
using Serilog.Formatting.Compact;
using Tempo.DatabaseMigrator;

// CLI entry point for local development against docker-compose.local.yml's
// PostgreSQL container. The deployed Lambda entry point (Function.cs) is
// invoked separately by CI/CD and does not use this Main method at all.

Log.Logger = new LoggerConfiguration()
    .Enrich.FromLogContext()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateLogger();

// DATABASE_URL (a postgresql:// URL, such as the Neon owner URL from SSM)
// sets the endpoint and the master credential in one value, with TLS in
// VerifyFull mode. Without it, docker-compose.local.yml's PostgreSQL runs
// without TLS, so the local default is SSL off; set DATABASE_SSL_MODE=Require
// (any Npgsql SslMode name) for another database that needs TLS.
var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");

var (endpoint, masterCredentials) = databaseUrl is not null
    ? DatabaseUrl.Parse(databaseUrl)
    : (
        new DatabaseEndpoint(
            Environment.GetEnvironmentVariable("DATABASE_HOST") ?? "localhost",
            int.Parse(Environment.GetEnvironmentVariable("DATABASE_PORT") ?? "5432", System.Globalization.CultureInfo.InvariantCulture),
            Environment.GetEnvironmentVariable("DATABASE_NAME") ?? "tempo",
            Enum.Parse<Npgsql.SslMode>(Environment.GetEnvironmentVariable("DATABASE_SSL_MODE") ?? nameof(Npgsql.SslMode.Disable), ignoreCase: true)),
        (
            Environment.GetEnvironmentVariable("DATABASE_MASTER_USERNAME") ?? "tempo",
            Environment.GetEnvironmentVariable("DATABASE_MASTER_PASSWORD") ?? "tempo"));

var applicationCredentials = (
    Environment.GetEnvironmentVariable("DATABASE_APPLICATION_USERNAME") ?? Function.ApplicationUsername,
    Environment.GetEnvironmentVariable("DATABASE_APPLICATION_PASSWORD") ?? Guid.NewGuid().ToString("N"));

var migratorCredentials = (
    Environment.GetEnvironmentVariable("DATABASE_MIGRATOR_USERNAME") ?? Function.MigratorUsername,
    Environment.GetEnvironmentVariable("DATABASE_MIGRATOR_PASSWORD") ?? Guid.NewGuid().ToString("N"));

var log = new SerilogUpgradeLog(Log.Logger);

try
{
    var result = await MigrationRunner.RunAsync(
        endpoint,
        masterCredentials,
        applicationCredentials,
        migratorCredentials,
        log,
        CancellationToken.None);

    Console.WriteLine($"Migration successful. Applied: {string.Join(", ", result.AppliedScripts)}");
    return 0;
}
catch (Exception ex)
{
    Log.Error(ex, "Local migration run failed");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}
