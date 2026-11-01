using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Worker.Consumers;

namespace Tempo.Worker.Consumers.Outbox;

/// <summary>
/// Phase 0 skeleton for the transactional outbox worker (ADR-0008, LLD
/// section 16.4). No outbox table exists yet - the real implementation
/// will claim unpublished, tenant-scoped outbox rows, publish each to
/// EventBridge, then mark them published, tolerating redelivery
/// idempotently. This handler only proves the queue -> Lambda -> log path.
/// </summary>
public sealed class OutboxMessageHandler(ILogger logger) : IQueueMessageHandler
{
    public Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        // Never log a message body, not even a prefix: it may carry personal data (LLD section 15.3, #541 SR-21).
        logger.Information(
            "Received outbox-publish message {MessageId}. CorrelationId={CorrelationId}",
            record.MessageId,
            correlationId);

        return Task.CompletedTask;
    }
}
