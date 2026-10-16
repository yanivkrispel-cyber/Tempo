using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Notifications.Domain;
using Tempo.Platform.Modules.Scheduling.Domain;

namespace Tempo.Platform.Modules.Notifications.Application;

/// <summary>
/// The `notifications.deliver` work (docs/30 section 8), run by the worker as the platform role across studios.
/// Takes the requests of the last two days that have no push line yet, applies preferences, subscriptions and
/// quiet hours (section 7, D-4) and writes one push delivery each. Nothing leaves the app yet: until the push
/// adapter exists every line ends skipped or queued. Safe to run twice: a request gets one line per channel.
/// </summary>
public sealed class NotificationDeliveryJob(IDataSourceProvider dataSources, TimeProvider clock, bool pushAvailable = false)
{
    private const int BatchSize = 500;

    public async Task<(int Routed, int Skipped)> RunAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);

        var pending = new List<Pending>();
        await using (var command = unitOfWork.Command(
            """
            SELECT r.organization_id, r.id, r.kind, o.time_zone,
                   coalesce(p.enabled, true),
                   EXISTS (SELECT 1 FROM notifications.push_subscriptions ps WHERE ps.organization_id = r.organization_id AND ps.person_id = r.person_id),
                   coalesce(q.starts_local, st.quiet_starts_local, '22:00'), coalesce(q.ends_local, st.quiet_ends_local, '08:00'),
                   s.starts_at
            FROM notifications.requests r
            JOIN organizations.organizations o ON o.id = r.organization_id
            LEFT JOIN notifications.preferences p
              ON p.organization_id = r.organization_id AND p.person_id = r.person_id AND p.channel = 'push'
             AND p."group" = CASE WHEN r.kind LIKE 'reminder.%' THEN 'reminders'
                                  WHEN r.kind IN ('session.message', 'studio.announcement') THEN 'studio'
                                  ELSE 'bookings' END
            LEFT JOIN notifications.quiet_hours q ON q.organization_id = r.organization_id AND q.person_id = r.person_id
            LEFT JOIN notifications.studio_settings st ON st.organization_id = r.organization_id
            LEFT JOIN scheduling.sessions s ON s.organization_id = r.organization_id AND s.id = (r.data ->> 'sessionId')::uuid
            WHERE r.created_at > $1
              AND NOT EXISTS (SELECT 1 FROM notifications.deliveries d
                              WHERE d.organization_id = r.organization_id AND d.request_id = r.id AND d.channel = 'push')
            ORDER BY r.created_at
            LIMIT $2
            """,
            now.AddDays(-2), BatchSize))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                pending.Add(new Pending(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetBoolean(4),
                    reader.GetBoolean(5),
                    new QuietWindow(await reader.GetFieldValueAsync<TimeOnly>(6, cancellationToken), await reader.GetFieldValueAsync<TimeOnly>(7, cancellationToken)),
                    await reader.IsDBNullAsync(8, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(8, cancellationToken)));
            }
        }

        var skipped = 0;
        foreach (var request in pending)
        {
            var zone = TimeZoneInfo.TryFindSystemTimeZoneById(request.TimeZone, out var found) ? found : TimeZoneInfo.Utc;
            var decision = NotificationRouter.RoutePush(new RouteInput(
                request.Kind,
                request.PushEnabled,
                request.HasSubscription,
                pushAvailable,
                request.Quiet,
                TimeZoneInfo.ConvertTime(now, zone).DateTime,
                request.ClassStartsAt is { } starts ? TimeZoneInfo.ConvertTime(starts, zone).DateTime : null));
            DateTimeOffset? nextAttempt = null;
            if (decision.Status == "queued")
            {
                nextAttempt = decision.NotBeforeLocal is { } local ? StudioTime.ToInstant(DateOnly.FromDateTime(local), TimeOnly.FromDateTime(local), zone) : now;
            }

            skipped += decision.Status == "skipped" ? 1 : 0;

            await using var insert = unitOfWork.Command(
                """
                INSERT INTO notifications.deliveries (organization_id, id, request_id, channel, status, skip_reason, next_attempt_at, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
                ON CONFLICT (organization_id, request_id, channel) DO NOTHING
                """,
                request.OrganizationId, Guid.CreateVersion7(), request.Id, decision.Channel, decision.Status, decision.SkipReason, nextAttempt, now);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return (pending.Count, skipped);
    }

    private sealed record Pending(Guid OrganizationId, Guid Id, string Kind, string TimeZone, bool PushEnabled, bool HasSubscription, QuietWindow Quiet, DateTimeOffset? ClassStartsAt);
}
