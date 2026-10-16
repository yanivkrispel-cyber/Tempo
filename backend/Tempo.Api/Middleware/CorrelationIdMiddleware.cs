using System.Text.RegularExpressions;
using Serilog.Context;

namespace Tempo.Api.Middleware;

/// <summary>
/// Reads (or generates) the request correlation id, echoes it back on the
/// response, and pushes it into the Serilog log context so every log line
/// for this request is correlated. A client's id is taken only when it is
/// short and plain (letters, digits, dashes), because it lands in every log
/// line and in `audit_events.correlation_id` (#124); anything else is replaced.
/// </summary>
public sealed partial class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-Id";
    public const string ItemKey = "CorrelationId";

    [GeneratedRegex("^[A-Za-z0-9-]{1,64}$")]
    private static partial Regex Acceptable();

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers.TryGetValue(HeaderName, out var existing) &&
                             Acceptable().IsMatch(existing.ToString())
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
