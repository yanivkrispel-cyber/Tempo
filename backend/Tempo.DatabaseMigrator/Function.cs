using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Serilog;
using Serilog.Formatting.Compact;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Tempo.DatabaseMigrator;

public sealed record MigrationResponse(bool Successful, string[] AppliedScripts);

/// <summary>
/// tempo-{env}-database-migrator. Invoked synchronously by the deployment
/// workflow only (LLD section 11) - never by API Gateway, never at API/Worker
/// startup. IAM invocation is restricted to the deployment role; a failed
/// invocation (including an unhandled exception here) reports a Lambda
/// function error, which the calling `aws lambda invoke` step treats as a
/// failed deployment step.
/// </summary>
[SuppressMessage("Design", "CA1716", Justification = "Class name is the deployed Lambda handler; infrastructure/lib/data/database-stack.ts references 'Tempo.DatabaseMigrator.Function::FunctionHandler' by name.")]
public static class Function
{
    private static readonly ILogger Logger = new LoggerConfiguration()
        .Enrich.FromLogContext()
        .Enrich.WithProperty("service", "tempo-database-migrator")
        .WriteTo.Console(new RenderedCompactJsonFormatter())
        .CreateLogger();

    public static async Task<MigrationResponse> FunctionHandler(object? request, ILambdaContext context)
    {
        using var secretsClient = new AmazonSecretsManagerClient();

        var masterSecret = await GetSecretAsync(secretsClient, RequireEnv("MASTER_SECRET_ARN"));
        var applicationSecret = await GetSecretAsync(secretsClient, RequireEnv("APPLICATION_SECRET_ARN"));
        var migratorSecret = await GetSecretAsync(secretsClient, RequireEnv("MIGRATOR_SECRET_ARN"));

        // The master secret is enriched with host/port/dbname automatically
        // once RDS attaches it to the cluster; the application/migrator
        // secrets only carry username/password/dbname, so host/port always
        // come from the master secret regardless of which role connects.
        var endpoint = new DatabaseEndpoint(
            masterSecret.RootElement.GetProperty("host").GetString()!,
            masterSecret.RootElement.GetProperty("port").GetInt32(),
            masterSecret.RootElement.GetProperty("dbname").GetString()!);

        var log = new SerilogUpgradeLog(Logger);

        var result = await MigrationRunner.RunAsync(
            endpoint,
            ReadCredential(masterSecret),
            ReadCredential(applicationSecret),
            ReadCredential(migratorSecret),
            log,
            CancellationToken.None);

        return new MigrationResponse(result.Successful, result.AppliedScripts);
    }

    private static (string Username, string Password) ReadCredential(JsonDocument secret) => (
        secret.RootElement.GetProperty("username").GetString()!,
        secret.RootElement.GetProperty("password").GetString()!);

    private static async Task<JsonDocument> GetSecretAsync(AmazonSecretsManagerClient client, string secretArn)
    {
        var response = await client.GetSecretValueAsync(new GetSecretValueRequest { SecretId = secretArn });
        return JsonDocument.Parse(response.SecretString);
    }

    private static string RequireEnv(string name) =>
        Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"Missing required environment variable '{name}'.");
}
