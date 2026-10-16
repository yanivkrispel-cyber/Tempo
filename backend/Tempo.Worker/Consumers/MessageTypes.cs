namespace Tempo.Worker.Consumers;

/// <summary>
/// Values of the <c>MessageType</c> attribute on work-queue messages. Every
/// producer sets one; the worker routes on it (ADR-0008 amendment).
/// </summary>
public static class MessageTypes
{
    /// <summary>A transactional outbox row to publish (ADR-0008, LLD section 16.4).</summary>
    public const string OutboxPublish = "outbox.publish";

    /// <summary>The deployment smoke test's probe message (LLD section 38).</summary>
    public const string SmokeTest = "smoke-test";

    /// <summary>The daily 10-studio check, sent by EventBridge Scheduler (docs/26 section 10.2).</summary>
    public const string TripwireCheck = "tripwire.check";

    /// <summary>The daily scheduling job: horizon and closed waitlists, sent by EventBridge Scheduler (docs/29 section 11).</summary>
    public const string SchedulingDaily = "scheduling.daily";

    /// <summary>The daily retention job: old finished invitations and inbox items go, sent by EventBridge Scheduler (night board #136, B4).</summary>
    public const string RetentionDaily = "retention.daily";

    /// <summary>Route the push line of recent notification requests (docs/30 section 8; day board #176, P3).</summary>
    public const string NotificationsDeliver = "notifications.deliver";

    /// <summary>Write the due reminders and deliver them, sent hourly in the daytime by EventBridge Scheduler (day board #176, P5).</summary>
    public const string NotificationsReminders = "notifications.reminders_hourly";
}
