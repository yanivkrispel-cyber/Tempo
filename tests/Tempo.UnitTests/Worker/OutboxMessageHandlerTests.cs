using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using FluentAssertions;
using NSubstitute;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Tempo.Worker.Consumers.Outbox;
using Xunit;

namespace Tempo.UnitTests.Worker;

/// <summary>A message body may carry personal data, so the outbox handler never logs it, not even a prefix (#541 SR-21).</summary>
public sealed class OutboxMessageHandlerTests
{
    [Fact]
    public async Task HandleAsync_LogsTheId_NotTheBody()
    {
        var sink = new Captured();
        var logger = new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger();

        await new OutboxMessageHandler(logger).HandleAsync(
            new SQSEvent.SQSMessage { MessageId = "msg-7", Body = "{\"email\":\"someone@example.com\"}" },
            "corr-1",
            Substitute.For<ILambdaContext>());

        var text = string.Join('\n', sink.Events.Select(e => e.RenderMessage() + string.Join(' ', e.Properties.Values)));
        text.Should().Contain("msg-7");
        text.Should().NotContain("someone@example.com");
    }

    private sealed class Captured : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent) => Events.Add(logEvent);
    }
}
