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
    private static readonly ILogger Logger = new LoggerConfiguration().CreateLogger();

    [Fact]
    public async Task HandleAsync_RoutesToOutboxHandler_ForOutboxQueueMessages()
    {
        var outboxHandler = Substitute.For<IQueueMessageHandler>();
        var smokeTestHandler = Substitute.For<IQueueMessageHandler>();
        var dispatcher = new SqsMessageDispatcher(Logger, outboxHandler, smokeTestHandler);

        var sqsEvent = BuildEvent("arn:aws:sqs:eu-central-1:123456789012:tempo-dev-outbox-publish", "msg-1");

        var response = await dispatcher.HandleAsync(sqsEvent, FakeContext());

        response.BatchItemFailures.Should().BeEmpty();
        await outboxHandler.Received(1).HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
        await smokeTestHandler.DidNotReceive().HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Fact]
    public async Task HandleAsync_RoutesToSmokeTestHandler_ForSmokeTestQueueMessages()
    {
        var outboxHandler = Substitute.For<IQueueMessageHandler>();
        var smokeTestHandler = Substitute.For<IQueueMessageHandler>();
        var dispatcher = new SqsMessageDispatcher(Logger, outboxHandler, smokeTestHandler);

        var sqsEvent = BuildEvent("arn:aws:sqs:eu-central-1:123456789012:tempo-dev-smoke-test", "msg-2");

        await dispatcher.HandleAsync(sqsEvent, FakeContext());

        await smokeTestHandler.Received(1).HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
        await outboxHandler.DidNotReceive().HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Fact]
    public async Task HandleAsync_ReportsBatchItemFailure_WhenHandlerThrows_WithoutFailingWholeBatch()
    {
        var outboxHandler = Substitute.For<IQueueMessageHandler>();
        outboxHandler
            .HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>())
            .Returns<Task>(_ => throw new InvalidOperationException("simulated poison message"));
        var smokeTestHandler = Substitute.For<IQueueMessageHandler>();
        var dispatcher = new SqsMessageDispatcher(Logger, outboxHandler, smokeTestHandler);

        var sqsEvent = new SQSEvent
        {
            Records =
            [
                Record("arn:aws:sqs:eu-central-1:123456789012:tempo-dev-outbox-publish", "bad-message"),
                Record("arn:aws:sqs:eu-central-1:123456789012:tempo-dev-smoke-test", "good-message")
            ]
        };

        var response = await dispatcher.HandleAsync(sqsEvent, FakeContext());

        response.BatchItemFailures.Should().ContainSingle(f => f.ItemIdentifier == "bad-message");
        await smokeTestHandler.Received(1).HandleAsync(Arg.Any<SQSEvent.SQSMessage>(), Arg.Any<string>(), Arg.Any<ILambdaContext>());
    }

    [Fact]
    public async Task HandleAsync_UsesCorrelationIdMessageAttribute_WhenPresent()
    {
        IQueueMessageHandler outboxHandler = Substitute.For<IQueueMessageHandler>();
        var smokeTestHandler = Substitute.For<IQueueMessageHandler>();
        var dispatcher = new SqsMessageDispatcher(Logger, outboxHandler, smokeTestHandler);

        var record = Record("arn:aws:sqs:eu-central-1:123456789012:tempo-dev-outbox-publish", "msg-3");
        record.MessageAttributes = new Dictionary<string, SQSEvent.MessageAttribute>
        {
            ["CorrelationId"] = new() { StringValue = "propagated-correlation-id", DataType = "String" }
        };

        await dispatcher.HandleAsync(new SQSEvent { Records = [record] }, FakeContext());

        await outboxHandler.Received(1).HandleAsync(record, "propagated-correlation-id", Arg.Any<ILambdaContext>());
    }

    private static SQSEvent BuildEvent(string eventSourceArn, string messageId) =>
        new() { Records = [Record(eventSourceArn, messageId)] };

    private static SQSEvent.SQSMessage Record(string eventSourceArn, string messageId) =>
        new() { MessageId = messageId, EventSourceArn = eventSourceArn, Body = "{}" };

    private static ILambdaContext FakeContext()
    {
        var context = Substitute.For<ILambdaContext>();
        context.AwsRequestId.Returns("fallback-request-id");
        return context;
    }
}
