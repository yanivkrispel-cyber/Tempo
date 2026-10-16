using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Platform.Modules.Notifications.Application;

namespace Tempo.Worker.Consumers.Notifications;

/// <summary>
/// The `notifications.deliver` work (docs/30 section 8): routes the push line of recent requests through
/// <see cref="NotificationDeliveryJob"/>. Logs counts only, never a kind's text or an address.
/// </summary>
public sealed class NotificationDeliveryMessageHandler(ILogger logger, NotificationDeliveryJob job) : IQueueMessageHandler
{
    public async Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        var (routed, skipped) = await job.RunAsync(CancellationToken.None);
        logger.Information(
            "Notification delivery: {Routed} requests routed, {Skipped} push lines skipped. CorrelationId={CorrelationId}",
            routed,
            skipped,
            correlationId);
    }
}
