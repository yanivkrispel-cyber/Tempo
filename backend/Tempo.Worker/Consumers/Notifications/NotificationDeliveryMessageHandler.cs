using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Platform.Modules.Notifications.Application;

namespace Tempo.Worker.Consumers.Notifications;

/// <summary>
/// The `notifications.deliver` work (docs/30 section 8): routes and sends the push line of recent requests
/// through <see cref="NotificationDeliveryJob"/>. Logs counts only, never a text, an endpoint or a key.
/// </summary>
public sealed class NotificationDeliveryMessageHandler(ILogger logger, NotificationDeliveryJob job) : IQueueMessageHandler
{
    public async Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        var run = await job.RunAsync(CancellationToken.None);
        logger.Information(
            "Notification delivery: {Routed} requests routed, {Skipped} push lines skipped, {Accepted} accepted, {Retried} to retry, {Dead} dead, {Removed} devices removed. CorrelationId={CorrelationId}",
            run.Routed,
            run.Skipped,
            run.Accepted,
            run.Retried,
            run.Dead,
            run.SubscriptionsRemoved,
            correlationId);
        foreach (var zone in job.UnknownTimeZones)
        {
            logger.Warning("Notification delivery routed studios with unknown time zone {TimeZone} in UTC. CorrelationId={CorrelationId}", zone, correlationId);
        }
    }
}
