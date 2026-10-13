using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;

namespace Tempo.Worker.Consumers;

/// <summary>
/// Routes each record of the single work queue (ADR-0008 amendment) to the
/// handler for its message type, read from the <see cref="MessageTypeAttribute"/>
/// message attribute, and reports partial batch failures (LLD section
/// 15.3 / 12.4): a failed item is listed in
/// <see cref="SQSBatchResponse.BatchItemFailures"/> so only that message is
/// retried and eventually dead-lettered. A message without a known type
/// fails the same way; it is never silently acknowledged, and one bad
/// message never fails the whole batch.
/// </summary>
public sealed class SqsMessageDispatcher(ILogger logger, IReadOnlyDictionary<string, IQueueMessageHandler> handlers)
{
    public const string MessageTypeAttribute = "MessageType";

    public async Task<SQSBatchResponse> HandleAsync(SQSEvent sqsEvent, ILambdaContext context)
    {
        var failures = new List<SQSBatchResponse.BatchItemFailure>();

        foreach (var record in sqsEvent.Records)
        {
            var correlationId = ExtractAttribute(record, "CorrelationId") ?? context.AwsRequestId;
            var messageType = ExtractAttribute(record, MessageTypeAttribute);

            try
            {
                if (messageType is null || !handlers.TryGetValue(messageType, out var handler))
                {
                    throw new InvalidOperationException($"No handler for message type '{messageType ?? "(missing)"}'.");
                }

                await handler.HandleAsync(record, correlationId, context);
            }
            catch (Exception ex)
            {
                logger.Error(
                    ex,
                    "Failed to process message {MessageId} of type {MessageType}. CorrelationId={CorrelationId}",
                    record.MessageId,
                    messageType,
                    correlationId);
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
            }
        }

        return new SQSBatchResponse(failures);
    }

    private static string? ExtractAttribute(SQSEvent.SQSMessage record, string name)
    {
        if (record.MessageAttributes is not null &&
            record.MessageAttributes.TryGetValue(name, out var attribute))
        {
            return attribute.StringValue;
        }

        return null;
    }
}
