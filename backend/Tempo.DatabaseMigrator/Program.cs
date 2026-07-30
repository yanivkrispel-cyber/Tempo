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

var endpoint = new DatabaseEndpoint(
    Environment.GetEnvironmentVariable("DATABASE_HOST") ?? "localhost",
    int.Parse(Environment.GetEnvironmentVariable("DATABASE_PORT") ?? "5432"),
    Environment.GetEnvironmentVariable("DATABASE_NAME") ?? "tempo");

var masterCredentials = (
    Environment.GetEnvironmentVariable("DATABASE_MASTER_USERNAME") ?? "tempo",
    Environment.GetEnvironmentVariable("DATABASE_MASTER_PASSWORD") ?? "tempo");

var applicationCredentials = (
    Environment.GetEnvironmentVariable("DATABASE_APPLICATION_USERNAME") ?? "tempo_app",
    Environment.GetEnvironmentVariable("DATABASE_APPLICATION_PASSWORD") ?? Guid.NewGuid().ToString("N"));

var migratorCredentials = (
    Environment.GetEnvironmentVariable("DATABASE_MIGRATOR_USERNAME") ?? "tempo_migrator",
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
