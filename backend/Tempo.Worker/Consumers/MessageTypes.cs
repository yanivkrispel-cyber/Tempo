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
}
