using Amazon.S3;
using Amazon.Lambda.AspNetCoreServer.Hosting;
using Serilog;
using Serilog.Formatting.Compact;
using Tempo.Api.DependencyInjection;
using Tempo.Api.Endpoints;
using Tempo.Platform.Modules.Media;
using Tempo.Api.Middleware;
using Amazon.SQS;
using Tempo.Api.Notifications;
using Tempo.Platform.Modules.Notifications.Application;

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
    // Pictures (docs/33 section 6, D17): the environment's bucket when deployed, none locally.
    builder.Services.AddSingleton<IMediaStore>(builder.Configuration["MEDIA_BUCKET"] is { Length: > 0 } bucket
        ? new S3MediaStore(new AmazonS3Client(), bucket)
        : new UnavailableMediaStore());
    builder.Services.AddCognitoAuthentication(builder.Configuration);

    var app = builder.Build();

    // Deployed, the work queue's URL is set and requests reach the worker at once; locally and in tests nothing
    // is sent (docs/30 section 8).
    if (app.Configuration["WORK_QUEUE_URL"] is { Length: > 0 } workQueueUrl)
    {
        var signal = new SqsNotificationSignal(new AmazonSQSClient(), workQueueUrl, app.Services.GetRequiredService<ILogger<SqsNotificationSignal>>());
        NotificationSignal.Send = signal.SendAsync;
    }

    app.UseMiddleware<CorrelationIdMiddleware>();
    app.UseMediaLinks();
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
    app.MapBrandEndpoints();
    app.MapPublicStudioEndpoints();
    app.MapMarketingEndpoints();
    app.MapRoleEndpoints();
    app.MapOwnershipEndpoints();
    app.MapPeopleEndpoints();
    app.MapPeopleImportEndpoints();
    app.MapTagsAndNotesEndpoints();
    app.MapConsentEndpoints();
    app.MapPersonLifecycleEndpoints();
    app.MapScheduleEndpoints();
    app.MapPassEndpoints();
    app.MapBookingEndpoints();
    app.MapSpotEndpoints();
    app.MapBuddyEndpoints();
    app.MapMediaEndpoints();
    app.MapInstructorEndpoints();
    app.MapCheckinEndpoints();
    app.MapInsightEndpoints();
    app.MapProgressEndpoints();
    app.MapReportEndpoints();
    app.MapHealthDeclarationEndpoints();
    app.MapClassEndpoints();
    app.MapNotificationEndpoints();
    app.MapBillingEndpoints();
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

