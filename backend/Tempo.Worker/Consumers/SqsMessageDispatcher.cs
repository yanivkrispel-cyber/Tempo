using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;

namespace Tempo.Worker.Consumers;

/// <summary>
/// Routes each SQS record to the handler for its source queue and reports
/// partial batch failures (LLD section 15.3 / 12.4) - a failed item is
/// listed in <see cref="SQSBatchResponse.BatchItemFailures"/> so only that
/// message is retried/DLQ'd; it is never silently acknowledged as
/// successful, and one bad message never fails the whole batch.
/// </summary>
public sealed class SqsMessageDispatcher(ILogger logger, IQueueMessageHandler outboxHandler, IQueueMessageHandler smokeTestHandler)
{
    public async Task<SQSBatchResponse> HandleAsync(SQSEvent sqsEvent, ILambdaContext context)
    {
        var failures = new List<SQSBatchResponse.BatchItemFailure>();

        foreach (var record in sqsEvent.Records)
        {
            var correlationId = ExtractCorrelationId(record) ?? context.AwsRequestId;

            try
            {
                if (record.EventSourceArn.EndsWith("smoke-test", StringComparison.OrdinalIgnoreCase))
                {
                    await smokeTestHandler.HandleAsync(record, correlationId, context);
                }
                else
                {
                    await outboxHandler.HandleAsync(record, correlationId, context);
                }
            }
            catch (Exception ex)
            {
                logger.Error(
                    ex,
                    "Failed to process message {MessageId} from {EventSourceArn}. CorrelationId={CorrelationId}",
                    record.MessageId,
                    record.EventSourceArn,
                    correlationId);
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
            }
        }

        return new SQSBatchResponse(failures);
    }

    private static string? ExtractCorrelationId(SQSEvent.SQSMessage record)
    {
        if (record.MessageAttributes is not null &&
            record.MessageAttributes.TryGetValue("CorrelationId", out var attribute))
        {
            return attribute.StringValue;
        }

        return null;
    }
}
