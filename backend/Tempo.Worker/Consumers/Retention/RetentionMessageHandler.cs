using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Platform.Modules.Retention.Application;

namespace Tempo.Worker.Consumers.Retention;

/// <summary>
/// The daily retention job (night board #136, B4). EventBridge Scheduler puts a `retention.daily` message on the
/// work queue once a day; the work itself is <see cref="RetentionJob"/>. Logs counts only.
/// </summary>
public sealed class RetentionMessageHandler(ILogger logger, RetentionJob job) : IQueueMessageHandler
{
    public async Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        var (invitations, inboxItems, deliveries, announcements) = await job.RunAsync(CancellationToken.None);
        logger.Information(
            "Retention job: {Invitations} invitations, {InboxItems} inbox items, {Deliveries} deliveries and {Announcements} announcements deleted. CorrelationId={CorrelationId}",
            invitations,
            inboxItems,
            deliveries,
            announcements,
            correlationId);
    }
}
