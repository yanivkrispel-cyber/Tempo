using Serilog.Context;

namespace Tempo.Api.Middleware;

/// <summary>
/// Reads (or generates) the request correlation id, echoes it back on the
/// response, and pushes it into the Serilog log context so every log line
/// for this request is correlated.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-Id";
    public const string ItemKey = "CorrelationId";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers.TryGetValue(HeaderName, out var existing) &&
                             !string.IsNullOrWhiteSpace(existing)
            ? existing.ToString()
            : Guid.NewGuid().ToString("n");

        context.Items[ItemKey] = correlationId;

        context.Response.OnStarting(() =>
        {
            context.Response.Headers[HeaderName] = correlationId;
            return Task.CompletedTask;
        });

        using (LogContext.PushProperty("correlationId", correlationId))
        {
            await next(context);
        }
    }
}
