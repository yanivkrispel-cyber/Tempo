using System.Diagnostics.CodeAnalysis;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
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
    public const string ApplicationUsername = "tempo_app";
    public const string MigratorUsername = "tempo_migrator";

    private static readonly ILogger Logger = new LoggerConfiguration()
        .Enrich.FromLogContext()
        .Enrich.WithProperty("service", "tempo-database-migrator")
        .WriteTo.Console(new RenderedCompactJsonFormatter())
        .CreateLogger();

    public static async Task<MigrationResponse> FunctionHandler(object? request, ILambdaContext context)
    {
        // On Neon, per ADR-0022, the owner URL and both role passwords are
        // SSM SecureString parameters that a person writes. The stack passes
        // only the parameter names, as the ADR-0015 amendment requires.
        var ownerUrlParameter = RequireEnv("OWNER_URL_PARAMETER");
        var applicationPasswordParameter = RequireEnv("APPLICATION_PASSWORD_PARAMETER");
        var migratorPasswordParameter = RequireEnv("MIGRATOR_PASSWORD_PARAMETER");

        using var ssm = new AmazonSimpleSystemsManagementClient();
        var response = await ssm.GetParametersAsync(new GetParametersRequest
        {
            Names = [ownerUrlParameter, applicationPasswordParameter, migratorPasswordParameter],
            WithDecryption = true
        });

        if (response.InvalidParameters is { Count: > 0 })
        {
            throw new InvalidOperationException($"Missing SSM parameters: {string.Join(", ", response.InvalidParameters)}.");
        }

        var values = response.Parameters.ToDictionary(p => p.Name, p => p.Value);
        var (endpoint, ownerCredential) = DatabaseUrl.Parse(values[ownerUrlParameter]);

        var result = await MigrationRunner.RunAsync(
            endpoint,
            ownerCredential,
            (ApplicationUsername, values[applicationPasswordParameter]),
            (MigratorUsername, values[migratorPasswordParameter]),
            new SerilogUpgradeLog(Logger),
            CancellationToken.None);

        return new MigrationResponse(result.Successful, result.AppliedScripts);
    }

    private static string RequireEnv(string name) =>
        Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"Missing required environment variable '{name}'.");
}
