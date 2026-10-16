using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Platform.Modules.Notifications.Application;

namespace Tempo.Worker.Consumers.Notifications;

/// <summary>
/// The hourly `notifications.reminders_hourly` work (docs/30 sections 8 and 11): writes the due reminders through
/// <see cref="ReminderJob"/>, then delivers them in the same wake, so the database is woken once per tick. Logs
/// counts only.
/// </summary>
public sealed class ReminderMessageHandler(ILogger logger, ReminderJob reminders, NotificationDeliveryJob delivery) : IQueueMessageHandler
{
    public async Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        var due = await reminders.RunAsync(CancellationToken.None);
        logger.Information(
            "Reminders: {ClassTomorrow} class tomorrow, {ClassSoon} class soon, {PassEnding} pass ending, {EntriesLow} entries low. CorrelationId={CorrelationId}",
            due.ClassTomorrow,
            due.ClassSoon,
            due.PassEnding,
            due.EntriesLow,
            correlationId);

        var run = await delivery.RunAsync(CancellationToken.None);
        logger.Information(
            "Notification delivery: {Routed} requests routed, {Skipped} push lines skipped, {Accepted} accepted, {Retried} to retry, {Dead} dead, {Removed} devices removed. CorrelationId={CorrelationId}",
            run.Routed,
            run.Skipped,
            run.Accepted,
            run.Retried,
            run.Dead,
            run.SubscriptionsRemoved,
            correlationId);
        foreach (var zone in delivery.UnknownTimeZones)
        {
            logger.Warning("Notification delivery routed studios with unknown time zone {TimeZone} in UTC. CorrelationId={CorrelationId}", zone, correlationId);
        }
    }
}
