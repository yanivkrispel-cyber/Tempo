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
        // The same address the other limiters count (ClientAddress): behind the edge, the viewer, not CloudFront (#541 SR-20).
        var key = $"{ClientAddress.Of(httpContext)}|{httpContext.GetRouteValue(PublicStudioRouteFilter.RouteValue)}";
        if (!Windows.ContainsKey(key) && Windows.Count >= MaxTracked)
        {
            // Full: drop the windows of earlier minutes. Never clear the current ones, or a flood of new keys (other
            // slugs) would give every caller a fresh window; while still full, a new key waits for the next minute.
            foreach (var (stale, _) in Windows.Where(entry => entry.Value.Minute != minute))
            {
                Windows.TryRemove(stale, out _);
            }

            if (Windows.Count >= MaxTracked)
            {
                return TooMany(httpContext, now);
            }
        }

        var window = Windows.AddOrUpdate(key, _ => new Window(minute, 1), (_, w) => w.Minute == minute ? w with { Count = w.Count + 1 } : new Window(minute, 1));
        if (window.Count > PerMinute)
        {
            return TooMany(httpContext, now);
        }

        return await next(context);
    }

    private static IResult TooMany(HttpContext httpContext, DateTimeOffset now)
    {
        httpContext.Response.Headers.RetryAfter = (60 - (now.ToUnixTimeSeconds() % 60)).ToString(CultureInfo.InvariantCulture);
        return Problems.Result(httpContext, StatusCodes.Status429TooManyRequests, "rate_limited", "Too many requests. Try again in a minute.");
    }

    /// <summary>Forgets every window; for tests.</summary>
    public static void Reset() => Windows.Clear();

    private sealed record Window(long Minute, int Count);
}
