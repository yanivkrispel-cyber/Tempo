using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using FluentAssertions;
using NSubstitute;
using Serilog;
using Tempo.Worker.Consumers;
using Xunit;

namespace Tempo.UnitTests.Worker;

public sealed class SqsMessageDispatcherTests
{
    private const string WorkQueueArn = "arn:aws:sqs:eu-central-1:123456789012:tempo-dev-work";

    private static readonly ILogger Logger = new LoggerConfiguration().CreateLogger();

    private readonly IQueueMessageHandler outboxHandler = Substitute.For<IQueueMessageHandler>();
    private readonly IQueueMessageHandler smokeTestHandler = Substitute.For<IQueueMessageHandler>();

    private SqsMessageDispatcher Dispatcher() => new(
        Logger,
        new Dictionary<string, IQueueMessageHandler>
        {
            [MessageTypes.OutboxPublish] = outboxHandler,
            [MessageTypes.SmokeTest] = smokeTestHandler
        });

    [Fact]
    public async Task HandleAsync_RoutesToOutboxHandler_ForOutboxPublishMessages()
    {
        var response = await Dispatcher().HandleAsync(BuildEvent(Record("msg-1", MessageTypes.OutboxPublish)), FakeContext());

        response.BatchItemFailures.Should().BeEmpty();
        await outboxHandler.Received(1).HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
        await smokeTestHandler.DidNotReceive().HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Fact]
    public async Task HandleAsync_RoutesToSmokeTestHandler_ForSmokeTestMessages()
    {
        await Dispatcher().HandleAsync(BuildEvent(Record("msg-2", MessageTypes.SmokeTest)), FakeContext());

        await smokeTestHandler.Received(1).HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
        await outboxHandler.DidNotReceive().HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("no-such-type")]
    public async Task HandleAsync_ReportsBatchItemFailure_ForMissingOrUnknownMessageType(string? messageType)
    {
        var response = await Dispatcher().HandleAsync(BuildEvent(Record("untyped", messageType)), FakeContext());

        response.BatchItemFailures.Should().ContainSingle(f => f.ItemIdentifier == "untyped");
        await outboxHandler.DidNotReceive().HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
        await smokeTestHandler.DidNotReceive().HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Fact]
    public async Task HandleAsync_ReportsBatchItemFailure_WhenHandlerThrows_WithoutFailingWholeBatch()
    {
        outboxHandler
            .HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>())
            .Returns<Task>(_ => throw new InvalidOperationException("simulated poison message"));

        var sqsEvent = new SQSEvent
        {
            Records =
            [
                Record("bad-message", MessageTypes.OutboxPublish),
                Record("good-message", MessageTypes.SmokeTest)
            ]
        };

        var response = await Dispatcher().HandleAsync(sqsEvent, FakeContext());

        response.BatchItemFailures.Should().ContainSingle(f => f.ItemIdentifier == "bad-message");
        await smokeTestHandler.Received(1).HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Fact]
    public async Task HandleAsync_UsesCorrelationIdMessageAttribute_WhenPresent()
    {
        var record = Record("msg-3", MessageTypes.OutboxPublish);
        record.MessageAttributes["CorrelationId"] = new SQSEvent.MessageAttribute { StringValue = "propagated-correlation-id", DataType = "String" };

        await Dispatcher().HandleAsync(BuildEvent(record), FakeContext());

        await outboxHandler.Received(1).HandleAsync(record, "propagated-correlation-id", Arg.Any<ILambdaContext>());
    }

    private static SQSEvent BuildEvent(SQSEvent.SQSMessage record) => new() { Records = [record] };

    private static SQSEvent.SQSMessage Record(string messageId, string? messageType)
    {
        var attributes = new Dictionary<string, SQSEvent.MessageAttribute>();
        if (messageType is not null)
        {
            attributes[SqsMessageDispatcher.MessageTypeAttribute] = new SQSEvent.MessageAttribute { StringValue = messageType, DataType = "String" };
        }

        return new SQSEvent.SQSMessage { MessageId = messageId, EventSourceArn = WorkQueueArn, Body = "{}", MessageAttributes = attributes };
    }

    private static ILambdaContext FakeContext()
    {
        var context = Substitute.For<ILambdaContext>();
        context.AwsRequestId.Returns("fallback-request-id");
        return context;
    }
}
