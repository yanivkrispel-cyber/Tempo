using System.Collections.Concurrent;
using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Xunit;

namespace Tempo.UnitTests.Api;

public sealed class RequestLoggingTests
{
    private const string RequestLoggingSource = "Serilog.AspNetCore.RequestLoggingMiddleware";

    [Fact]
    public async Task RequestCompletionEvent_GoesThroughTheHostLogger()
    {
        // Only the host's logger carries the service and environment
        // properties, so request events must not fall back to the static one.
        var events = new CapturingSink();
        using var hostLogger = new LoggerConfiguration().WriteTo.Sink(events).CreateLogger();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<Serilog.ILogger>(hostLogger)));

        var response = await factory.CreateClient().GetAsync("/api/v1/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var completion = await events.WaitForAsync(RequestLoggingSource);

        completion.Should().NotBeNull("the request completion event must go through the host logger");
        completion!.Properties["StatusCode"].Should().Be(new ScalarValue(200));
    }

    private sealed class CapturingSink : ILogEventSink
    {
        private readonly ConcurrentQueue<LogEvent> events = new();

        public void Emit(LogEvent logEvent) => events.Enqueue(logEvent);

        public async Task<LogEvent?> WaitForAsync(string sourceContext)
        {
            // The middleware may write the event after the response reaches the client.
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                var match = events.FirstOrDefault(e =>
                    e.Properties.TryGetValue("SourceContext", out var source) &&
                    source is ScalarValue { Value: string name } &&
                    name == sourceContext);
                if (match is not null)
                {
                    return match;
                }

                await Task.Delay(50);
            }

            return null;
        }
    }
}
