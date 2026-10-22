using Amazon.Runtime;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Tempo.Platform.BuildingBlocks.Diagnostics;
using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Api.DependencyInjection;

/// <summary>
/// Work a new Lambda environment would otherwise do on its first request, done during Init (board #445, P-1): the
/// endpoints are built before the runtime asks for the first event, and the two network waits of a first request,
/// Cognito's signing keys and the database password from SSM, start at once and run while the host starts. No database
/// connection is opened here: a cold start that serves only `/health` (the canary) must not wake Neon's compute.
/// Off outside Lambda, so tests and local runs are unchanged.
/// </summary>
public static class ColdStartWarmUp
{
    public static void Start(WebApplication app)
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME")))
        {
            return;
        }

        _ = Task.Run(() => SigningKeysAsync(app.Services));
        _ = Task.Run(() => DatabasePasswordAsync(app.Services));
        using (ColdStart.Current.Measure("init.endpoints"))
        {
            foreach (var source in ((IEndpointRouteBuilder)app).DataSources)
            {
                _ = source.Endpoints;
            }
        }
    }

    private static async Task SigningKeysAsync(IServiceProvider services)
    {
        try
        {
            using var timed = ColdStart.Current.Measure("init.jwks");
            // The handler reads the same ConfigurationManager from the options cache, so the first request finds the keys.
            var jwt = services.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>().Get(CognitoAuthentication.CustomerScheme);
            if (jwt.ConfigurationManager is { } configuration)
            {
                await configuration.GetConfigurationAsync(CancellationToken.None);
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or IOException or InvalidOperationException or OperationCanceledException)
        {
            // The first request fetches the keys itself, as before.
        }
    }

    private static async Task DatabasePasswordAsync(IServiceProvider services)
    {
        try
        {
            using var timed = ColdStart.Current.Measure("init.data-source");
            // Builds the app role's data source: the SSM read, cached for the life of the environment.
            await services.GetRequiredService<IDataSourceProvider>().GetAsync(DatabaseRole.Application, CancellationToken.None);
        }
        catch (Exception exception) when (exception is AmazonServiceException or AmazonClientException or InvalidOperationException or HttpRequestException)
        {
            // A failed build isn't cached (ConfiguredDataSourceProvider); the first request tries again.
        }
    }
}
