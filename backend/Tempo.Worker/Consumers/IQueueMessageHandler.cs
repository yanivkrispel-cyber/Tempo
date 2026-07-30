using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;

namespace Tempo.Worker.Consumers;

/// <summary>A single queue's message handler. Kept as an interface so SqsMessageDispatcher's routing is unit-testable.</summary>
public interface IQueueMessageHandler
{
    Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context);
}
