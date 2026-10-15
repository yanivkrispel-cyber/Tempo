using Amazon.Lambda.AspNetCoreServer.Hosting;
using Serilog;
using Serilog.Formatting.Compact;
using Tempo.Api.DependencyInjection;
using Tempo.Api.Endpoints;
using Tempo.Api.Middleware;

// Covers startup only. The host builds its own logger below and leaves this
// one alone, because a reloadable bootstrap logger can be frozen once per
// process and test hosts start in parallel in one process.
Log.Logger = new LoggerConfiguration()
    .Enrich.FromLogContext()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // Runs as a normal Kestrel app locally; auto-detects the Lambda
    // environment and switches to the HTTP API v2 event source there.
    builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

    builder.Host.UseSerilog(
        (context, _, configuration) => configuration
            .ReadFrom.Configuration(context.Configuration)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("service", "tempo-api")
            .Enrich.WithProperty("environment", Environment.GetEnvironmentVariable("TEMPO_ENVIRONMENT") ?? "local")
            .WriteTo.Console(new RenderedCompactJsonFormatter()),
        preserveStaticLogger: true);

    builder.Services.AddTempoApi();
    builder.Services.AddCognitoAuthentication(builder.Configuration);

    var app = builder.Build();

    app.UseMiddleware<CorrelationIdMiddleware>();
    app.UseExceptionHandler();
    // Without an explicit logger, request events go to the static startup logger.
    app.UseSerilogRequestLogging(options => options.Logger = app.Services.GetRequiredService<Serilog.ILogger>());
    app.UseAuthentication();
    app.UseAuthorization();

    // The contract is public (contracts/openapi in a public repo); ArchitectureTests lists every anonymous route.
    app.MapOpenApi().AllowAnonymous();
    app.MapHealthEndpoints();
    app.MapAccountEndpoints();
    app.MapOrganizationEndpoints();
    app.MapRoleEndpoints();
    app.MapOwnershipEndpoints();
    app.MapPeopleEndpoints();
    app.MapConsentEndpoints();
    app.MapPersonLifecycleEndpoints();
    app.MapScheduleEndpoints();
    app.MapPassEndpoints();
    app.MapBookingEndpoints();
    app.MapClassEndpoints();
    app.MapInvitationEndpoints();
    app.MapPlatformEndpoints();
    app.MapEndpointModules();

    await app.RunAsync();
}
finally
{
    await Log.CloseAndFlushAsync();
}

// Exposes the implicit Program class to Tempo.UnitTests' WebApplicationFactory<Program>.
public partial class Program
{
    protected Program()
    {
    }
}

