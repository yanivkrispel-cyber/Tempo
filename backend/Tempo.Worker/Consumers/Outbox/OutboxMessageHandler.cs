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
        logger.Information(
            "Received outbox-publish message {MessageId}. CorrelationId={CorrelationId}. BodyPreview={BodyPreview}",
            record.MessageId,
            correlationId,
            Truncate(record.Body));

        return Task.CompletedTask;
    }

    // Never log full message bodies - they may carry sensitive payloads (LLD section 15.3).
    private static string Truncate(string body) => body.Length > 200 ? body[..200] + "...(truncated)" : body;
}
