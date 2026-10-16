using Amazon.SQS;
using Amazon.SQS.Model;

namespace Tempo.Api.Notifications;

/// <summary>
/// Puts one `notifications.deliver` message on the work queue (WORK_QUEUE_URL) after a transaction that wrote
/// notification requests commits, so a promotion reaches the member's phone in seconds rather than at the next
/// scheduled run (docs/30 section 8). The body is empty: the worker reads what is due from the database. A failed
/// send is logged and swallowed; the requests stay and the next run routes them.
/// </summary>
public sealed partial class SqsNotificationSignal(IAmazonSQS sqs, string queueUrl, ILogger<SqsNotificationSignal> logger)
{
    public const string MessageType = "notifications.deliver";

    [LoggerMessage(Level = LogLevel.Warning, Message = "The notifications.deliver signal was not sent; the next run routes the requests.")]
    private static partial void LogNotSent(ILogger logger, Exception exception);

    public async Task SendAsync(CancellationToken cancellationToken)
    {
        try
        {
            await sqs.SendMessageAsync(
                new SendMessageRequest
                {
                    QueueUrl = queueUrl,
                    MessageBody = "{}",
                    MessageAttributes = new Dictionary<string, MessageAttributeValue>
                    {
                        ["MessageType"] = new() { DataType = "String", StringValue = MessageType }
                    }
                },
                CancellationToken.None);
        }
        catch (Exception e) when (e is AmazonSQSException or HttpRequestException or TaskCanceledException)
        {
            LogNotSent(logger, e);
        }
    }
}
