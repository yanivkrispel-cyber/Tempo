using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Worker.Consumers;

namespace Tempo.Worker.Consumers.SmokeTest;

/// <summary>
/// Handles messages from the smoke-test queue: proves the SQS -> Lambda
/// path (and, when the message originated from EventBridge or Scheduler,
/// that those paths reach SQS too) without touching any business data.
/// </summary>
public sealed class SmokeTestMessageHandler(ILogger logger) : IQueueMessageHandler
{
    public Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        logger.Information(
            "Processed smoke-test message {MessageId}. CorrelationId={CorrelationId}",
            record.MessageId,
            correlationId);

        return Task.CompletedTask;
    }
}
