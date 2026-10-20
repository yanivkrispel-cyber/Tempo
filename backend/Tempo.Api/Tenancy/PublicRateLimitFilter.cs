using System.Collections.Concurrent;
using System.Globalization;
using Tempo.Api.ErrorHandling;

namespace Tempo.Api.Tenancy;

/// <summary>
/// A fixed window per caller address and studio on the public routes (docs/37 section 4.2): 120 requests a minute,
/// then 429 with `Retry-After`. It is per Lambda instance, so it bounds a burst, not a determined crawler; the answers
/// are cacheable and hold no person's data, which is what keeps them cheap. No new AWS resource ($0, N-4).
/// </summary>
public sealed class PublicRateLimitFilter(TimeProvider clock) : IEndpointFilter
{
    public const int PerMinute = 120;
    private const int MaxTracked = 10_000;
    private static readonly ConcurrentDictionary<string, Window> Windows = new(StringComparer.Ordinal);

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;
        var now = clock.GetUtcNow();
        var minute = now.ToUnixTimeSeconds() / 60;
        var key = $"{httpContext.Connection.RemoteIpAddress}|{httpContext.GetRouteValue(PublicStudioRouteFilter.RouteValue)}";
        if (Windows.Count > MaxTracked)
        {
            Windows.Clear();
        }

        var window = Windows.AddOrUpdate(key, _ => new Window(minute, 1), (_, w) => w.Minute == minute ? w with { Count = w.Count + 1 } : new Window(minute, 1));
        if (window.Count > PerMinute)
        {
            httpContext.Response.Headers.RetryAfter = (60 - (now.ToUnixTimeSeconds() % 60)).ToString(CultureInfo.InvariantCulture);
            return Problems.Result(httpContext, StatusCodes.Status429TooManyRequests, "rate_limited", "Too many requests. Try again in a minute.");
        }

        return await next(context);
    }

    /// <summary>Forgets every window; for tests.</summary>
    public static void Reset() => Windows.Clear();

    private sealed record Window(long Minute, int Count);
}
