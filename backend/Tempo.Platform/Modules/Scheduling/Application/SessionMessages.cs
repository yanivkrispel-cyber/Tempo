using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Notifications.Application;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record SessionMessageView(Guid Id, Guid SessionId, int Recipients, DateTimeOffset CreatedAt);

/// <summary>
/// A short text from staff, or the class's instructor, to everyone registered on a class (docs/29 section 16.2).
/// The text lives in `notifications.session_messages` once; each recipient's inbox item points at it. The audit
/// log records that a message went out and to how many people, never what it said.
/// </summary>
public interface ISessionMessageService
{
    Task<SessionMessageView> SendAsync(TenantContext tenant, Guid sessionId, string? text, CancellationToken cancellationToken);
}

public sealed partial class BookingService : ISessionMessageService
{
    public const int MaxMessageLength = 500;
    public const int MessagesPerHour = 5;
    public const string MessageKind = "session.message";

    public async Task<SessionMessageView> SendAsync(TenantContext tenant, Guid sessionId, string? text, CancellationToken cancellationToken)
    {
        var body = text?.Trim() ?? string.Empty;
        if (body.Length is 0 or > MaxMessageLength)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "text.invalid", $"Write 1 to {MaxMessageLength} characters.", "text");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await StaffOrInstructorAsync(unitOfWork, tenant, sessionId, Permissions.BookingsManage, cancellationToken);
        // The session row is locked, so two staff sending at once cannot both pass the per-hour count below.
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        var now = clock.GetUtcNow();
        if (session.Status == "cancelled" || session.StartsAt < now.AddDays(-1))
        {
            throw Conflict("booking.closed", "This class is over.");
        }

        await using (var recent = unitOfWork.Command(
            "SELECT count(*)::int FROM notifications.session_messages WHERE organization_id = $1 AND session_id = $2 AND created_at > $3",
            tenant.OrganizationId, sessionId, now.AddHours(-1)))
        {
            if ((int)(await recent.ExecuteScalarAsync(cancellationToken))! >= MessagesPerHour)
            {
                throw Conflict("session.message_limit", $"At most {MessagesPerHour} messages per class per hour.");
            }
        }

        var recipients = new List<Guid>();
        await using (var list = unitOfWork.Command(
            """
            SELECT b.person_id FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = $1 AND b.session_id = $2 AND b.status IN ('booked', 'waitlisted')
              AND p.status NOT IN ('anonymized', 'merged')
            ORDER BY b.created_at
            """,
            tenant.OrganizationId, sessionId))
        await using (var reader = await list.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                recipients.Add(reader.GetGuid(0));
            }
        }

        var messageId = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            "INSERT INTO notifications.session_messages (organization_id, id, session_id, sent_by, body, recipients, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
            tenant.OrganizationId, messageId, sessionId, tenant.MembershipId, body, recipients.Count))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var personId in recipients)
        {
            await NotificationRequests.WriteAsync(
                unitOfWork,
                new NotificationRequest(tenant.OrganizationId, personId, MessageKind, "session_message", messageId, new Dictionary<string, Guid> { ["sessionId"] = sessionId, ["messageId"] = messageId }),
                cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "session.message_sent", "session", sessionId, tenant.CorrelationId, new { messageId, recipients = recipients.Count }),
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new SessionMessageView(messageId, sessionId, recipients.Count, now);
    }
}
