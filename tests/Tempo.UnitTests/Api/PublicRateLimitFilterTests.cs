using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Tempo.Api.Tenancy;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// The public routes' window per address and studio (docs/37 section 4.2) can't be emptied by a flood of other keys,
/// and behind the edge it counts the viewer, not CloudFront's address (#541 SR-20).
/// </summary>
[Collection(nameof(PublicRateLimitFilterTests))]
public sealed class PublicRateLimitFilterTests : IDisposable
{
    private const string HttpApiHost = "2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
    private const string FunctionUrlHost = "abc123.lambda-url.eu-central-1.on.aws";

    private readonly Clock clock = new() { Now = new DateTimeOffset(2026, 11, 1, 10, 0, 5, TimeSpan.Zero) };

    public PublicRateLimitFilterTests() => PublicRateLimitFilter.Reset();

    public void Dispose() => PublicRateLimitFilter.Reset();

    [Fact]
    public async Task AFloodOfOtherSlugs_DoesNotResetACallersWindow()
    {
        var filter = new PublicRateLimitFilter(clock);
        for (var i = 0; i < PublicRateLimitFilter.PerMinute; i++)
        {
            (await StatusAsync(filter, HttpApiHost, "198.51.100.7", null, "studio-a")).Should().Be(StatusCodes.Status200OK);
        }

        for (var i = 0; i <= 10_000; i++)
        {
            await StatusAsync(filter, HttpApiHost, "203.0.113.50", null, $"no-such-{i}");
        }

        (await StatusAsync(filter, HttpApiHost, "198.51.100.7", null, "studio-a")).Should().Be(StatusCodes.Status429TooManyRequests);
    }

    [Fact]
    public async Task AWindowFromAnEarlierMinute_IsForgotten()
    {
        var filter = new PublicRateLimitFilter(clock);
        for (var i = 0; i <= PublicRateLimitFilter.PerMinute; i++)
        {
            await StatusAsync(filter, HttpApiHost, "198.51.100.7", null, "studio-a");
        }

        clock.Now = clock.Now.AddMinutes(1);

        (await StatusAsync(filter, HttpApiHost, "198.51.100.7", null, "studio-a")).Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task BehindTheEdge_EachViewerHasItsOwnWindow()
    {
        var filter = new PublicRateLimitFilter(clock);
        for (var i = 0; i <= PublicRateLimitFilter.PerMinute; i++)
        {
            await StatusAsync(filter, FunctionUrlHost, "130.176.1.1", "203.0.113.9:443", "studio-a");
        }

        (await StatusAsync(filter, FunctionUrlHost, "130.176.1.1", "203.0.113.9:443", "studio-a")).Should().Be(StatusCodes.Status429TooManyRequests);
        (await StatusAsync(filter, FunctionUrlHost, "130.176.1.1", "198.51.100.20:443", "studio-a")).Should().Be(StatusCodes.Status200OK, "another viewer behind the same edge address");
    }

    private static async Task<int> StatusAsync(PublicRateLimitFilter filter, string host, string source, string? viewer, string slug)
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString(host);
        context.Connection.RemoteIpAddress = IPAddress.Parse(source);
        if (viewer is not null)
        {
            context.Request.Headers[ClientAddress.ViewerHeader] = viewer;
        }

        context.Request.RouteValues[PublicStudioRouteFilter.RouteValue] = slug;
        var result = await filter.InvokeAsync(
            EndpointFilterInvocationContext.Create(context),
            _ => ValueTask.FromResult<object?>(Results.Ok()));
        return result is IStatusCodeHttpResult { StatusCode: { } status } ? status : StatusCodes.Status200OK;
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; }

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
