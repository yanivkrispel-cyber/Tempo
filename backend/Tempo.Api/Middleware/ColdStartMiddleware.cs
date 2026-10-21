using System.Globalization;
using Tempo.Platform.BuildingBlocks.Diagnostics;

namespace Tempo.Api.Middleware;

/// <summary>
/// Times the first request of a new Lambda environment (board #445, P-1) and then gets out of the way: one log line
/// `cold start` with every phase in milliseconds, and the same phases as X-Ray subsegments of that invocation. Two
/// marks around authentication (<see cref="MarkBeforeAuthentication"/>, <see cref="MarkAfterAuthorization"/>) split
/// the request into the pipeline, the token check (the JWKS fetch on a new environment) and the endpoint.
/// </summary>
public sealed partial class ColdStartMiddleware(RequestDelegate next, ILogger<ColdStartMiddleware> logger)
{
    private const string BeforeAuthentication = "tempo.coldstart.before-auth";
    private const string AfterAuthorization = "tempo.coldstart.after-authz";

    public async Task InvokeAsync(HttpContext context)
    {
        var timeline = ColdStart.Current;
        if (!timeline.Recording)
        {
            await next(context);
            return;
        }

        var start = DateTimeOffset.UtcNow;
        try
        {
            await next(context);
        }
        finally
        {
            var end = DateTimeOffset.UtcNow;
            timeline.Record("request.first", start, end);
            if (context.Items[BeforeAuthentication] is DateTimeOffset beforeAuth)
            {
                timeline.Record("request.pipeline", start, beforeAuth);
                if (context.Items[AfterAuthorization] is DateTimeOffset afterAuthz)
                {
                    timeline.Record("request.auth", beforeAuth, afterAuthz);
                    timeline.Record("request.endpoint", afterAuthz, end);
                }
            }

            var phases = timeline.Finish();
            if (logger.IsEnabled(LogLevel.Information))
            {
                // "name=ms" pairs in order; a name can repeat (two connections opened in the first request).
                var timings = string.Join(' ', phases.Select(p => string.Create(CultureInfo.InvariantCulture, $"{p.Name}={p.Milliseconds:0}")));
                LogColdStart(logger, context.Request.Path.Value, timings);
            }

            XRaySubsegments.Send(phases.Where(p => p.Start >= start));
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "cold start {Path} {Phases}")]
    private static partial void LogColdStart(ILogger logger, string? path, string phases);

    public static Task MarkBeforeAuthentication(HttpContext context, RequestDelegate next) => Mark(context, next, BeforeAuthentication);

    public static Task MarkAfterAuthorization(HttpContext context, RequestDelegate next) => Mark(context, next, AfterAuthorization);

    private static Task Mark(HttpContext context, RequestDelegate next, string key)
    {
        if (ColdStart.Current.Recording)
        {
            context.Items[key] = DateTimeOffset.UtcNow;
        }

        return next(context);
    }
}
