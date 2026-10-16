using System.Text.Json;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Notifications.Domain;

namespace Tempo.Platform.Modules.Notifications.Application;

/// <summary>
/// "Tell this person about this subject" (docs/30 section 8). <see cref="Data"/> holds ids only, never names; it
/// becomes both the inbox item's and the request's `data`. <see cref="Occurrence"/> is the session date for a
/// reminder; for an event it is left null and the inbox item id is used, so a retried job never doubles a message.
/// </summary>
public sealed record NotificationRequest(
    Guid OrganizationId,
    Guid PersonId,
    string Kind,
    string SubjectType,
    Guid SubjectId,
    IReadOnlyDictionary<string, Guid> Data,
    string? Occurrence = null);

/// <summary>
/// Written by the domain code that tells a member something, inside its own transaction: the inbox item (what the
/// app shows, its title and body rendered from the studio's template or the default), the request the delivery
/// pipeline works from, and the inbox delivery, which is delivered by being written. Push is routed later by
/// <see cref="NotificationDeliveryJob"/>.
/// </summary>
public static class NotificationRequests
{
    /// <summary>Returns the inbox item id, or null when the dedupe key was already used and nothing was written.</summary>
    public static async Task<Guid?> WriteAsync(UnitOfWork unitOfWork, NotificationRequest request, CancellationToken cancellationToken)
    {
        var itemId = Guid.CreateVersion7();
        var requestId = Guid.CreateVersion7();
        var occurrence = request.Occurrence ?? itemId.ToString();
        var dedupeKey = $"{request.Kind}:{request.SubjectId}:{request.PersonId}:{occurrence}";
        var data = JsonSerializer.Serialize(request.Data.ToDictionary(p => p.Key, p => p.Value));

        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO notifications.requests (organization_id, id, kind, person_id, subject_type, subject_id, data, dedupe_key, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())
            ON CONFLICT (organization_id, dedupe_key) DO NOTHING
            """,
            request.OrganizationId, requestId, request.Kind, request.PersonId, request.SubjectType, request.SubjectId, data, dedupeKey))
        {
            if (await insert.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                return null;
            }
        }

        // The words are fixed when the item is written, so a later template change never rewrites what was sent.
        var words = await NotificationTexts.RenderAsync(
            unitOfWork, request.OrganizationId, request.PersonId, request.Kind, request.Data, TemplateCatalog.Inbox, cancellationToken);
        await using (var item = unitOfWork.Command(
            "INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, request_id, title, body, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now())",
            request.OrganizationId, itemId, request.PersonId, request.Kind, data, requestId, words?.Subject, words?.Body))
        {
            await item.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var delivery = unitOfWork.Command(
            "INSERT INTO notifications.deliveries (organization_id, id, request_id, channel, status, attempts, created_at, updated_at) VALUES ($1, $2, $3, $4, 'delivered', 1, now(), now())",
            request.OrganizationId, Guid.CreateVersion7(), requestId, NotificationRouter.Inbox))
        {
            await delivery.ExecuteNonQueryAsync(cancellationToken);
        }

        if (NotificationSignal.Send is { } send)
        {
            unitOfWork.AfterCommit(nameof(NotificationSignal), send);
        }

        return itemId;
    }
}

/// <summary>
/// How the API tells the worker that requests are waiting: set once at start-up to put one `notifications.deliver`
/// message on the work queue after each committed transaction that wrote requests. Unset (tests, local runs, the
/// worker itself) the requests wait for the next scheduled run. The sender logs and swallows its own failures.
/// </summary>
public static class NotificationSignal
{
    public static Func<CancellationToken, Task>? Send { get; set; }
}
