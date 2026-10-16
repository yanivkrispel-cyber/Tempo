using System.Text.Json;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Notifications.Domain;
using Tempo.Platform.Modules.Notifications.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Domain;

namespace Tempo.Platform.Modules.Notifications.Application;

/// <summary>What one run did: requests routed, push lines skipped by the router, and push lines sent or not.</summary>
public sealed record DeliveryRun(int Routed, int Skipped, int Accepted, int Retried, int Dead, int SubscriptionsRemoved);

/// <summary>
/// The `notifications.deliver` work (docs/30 section 8), run by the worker as the platform role across studios.
/// First it routes: the requests of the last two days without a push line get one (preferences, subscriptions,
/// quiet hours; section 7, D-4). Then it sends: due push lines are claimed, encrypted and posted to each of the
/// person's devices. A device the push service reports gone (404, 410) is deleted; a busy service is retried after
/// 1 minute, 10 minutes and 1 hour, then the line is dead. Without VAPID keys (no sender) nothing leaves the app
/// and every line is skipped as `channel_unavailable`. Safe to run twice: a request gets one line per channel and
/// a claimed line is not claimed again for ten minutes.
/// </summary>
public sealed class NotificationDeliveryJob(IDataSourceProvider dataSources, TimeProvider clock, Func<CancellationToken, Task<IPushSender?>>? pushSender = null)
{
    private const int BatchSize = 500;
    private const int SendBatchSize = 100;
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(10), TimeSpan.FromHours(1)];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<DeliveryRun> RunAsync(CancellationToken cancellationToken)
    {
        var sender = pushSender is null ? null : await pushSender(cancellationToken);
        var (routed, skipped) = await RouteAsync(sender is not null, cancellationToken);
        if (sender is null)
        {
            return new DeliveryRun(routed, skipped, 0, 0, 0, 0);
        }

        var (accepted, retried, dead, removed) = await SendAsync(sender, cancellationToken);
        return new DeliveryRun(routed, skipped, accepted, retried, dead, removed);
    }

    private async Task<(int Routed, int Skipped)> RouteAsync(bool pushAvailable, CancellationToken cancellationToken)
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

    private async Task<(int Accepted, int Retried, int Dead, int Removed)> SendAsync(IPushSender sender, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var claimed = new List<Claimed>();

        // Claim first, in its own short transaction, so a second run never sends the same line twice. A line left in
        // `sending` by a worker that died is claimed again after ten minutes.
        await using (var claim = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken))
        {
            await using (var command = claim.Command(
                """
                UPDATE notifications.deliveries d
                SET status = 'sending', attempts = d.attempts + 1, updated_at = $1
                FROM (
                    SELECT organization_id, id FROM notifications.deliveries
                    WHERE channel = 'push'
                      AND ((status IN ('queued', 'retry_scheduled') AND next_attempt_at <= $1)
                           OR (status = 'sending' AND updated_at <= $1 - interval '10 minutes'))
                    ORDER BY next_attempt_at
                    LIMIT $2
                    FOR UPDATE SKIP LOCKED
                ) due
                WHERE d.organization_id = due.organization_id AND d.id = due.id
                RETURNING d.organization_id, d.id, d.request_id, d.attempts
                """,
                now, SendBatchSize))
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    claimed.Add(new Claimed(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetInt32(3)));
                }
            }

            await claim.CommitAsync(cancellationToken);
        }

        int accepted = 0, retried = 0, dead = 0, removed = 0;
        foreach (var line in claimed)
        {
            var (kind, payload, targets) = await MessageAsync(line, cancellationToken);
            var outcomes = new List<(Guid Subscription, PushOutcome Outcome, int? Status)>();
            foreach (var (subscription, target) in targets)
            {
                var (outcome, status) = await sender.SendAsync(target, payload, NotificationGroups.IsClassService(kind), cancellationToken);
                outcomes.Add((subscription, outcome, status));
            }

            await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);
            foreach (var gone in outcomes.Where(o => o.Outcome == PushOutcome.Gone))
            {
                await ExecuteAsync(unitOfWork, "DELETE FROM notifications.push_subscriptions WHERE organization_id = $1 AND id = $2", cancellationToken, line.OrganizationId, gone.Subscription);
                removed++;
            }

            foreach (var ok in outcomes.Where(o => o.Outcome == PushOutcome.Accepted))
            {
                await ExecuteAsync(unitOfWork, "UPDATE notifications.push_subscriptions SET last_success_at = $3 WHERE organization_id = $1 AND id = $2", cancellationToken, line.OrganizationId, ok.Subscription, now);
            }

            var lastError = outcomes.LastOrDefault(o => o.Outcome is PushOutcome.Retry or PushOutcome.Failed).Status is { } code ? $"http_{code}" : null;
            string action;
            if (outcomes.Any(o => o.Outcome == PushOutcome.Accepted))
            {
                await SetAsync(unitOfWork, line, "accepted", null, null, null, now, cancellationToken);
                action = "notification.sent";
                accepted++;
            }
            else if (outcomes.All(o => o.Outcome == PushOutcome.Gone))
            {
                // Every device is gone, or none was left: nothing to retry.
                await SetAsync(unitOfWork, line, "skipped", "no_subscription", null, null, now, cancellationToken);
                action = "notification.skipped";
            }
            else if (outcomes.Any(o => o.Outcome == PushOutcome.Retry) && line.Attempts <= Backoff.Length)
            {
                await SetAsync(unitOfWork, line, "retry_scheduled", null, now + Backoff[line.Attempts - 1], lastError ?? "unreachable", now, cancellationToken);
                action = "notification.retry";
                retried++;
            }
            else
            {
                await SetAsync(unitOfWork, line, "dead", null, null, lastError ?? "unreachable", now, cancellationToken);
                action = "notification.failed";
                dead++;
            }

            // Kind, channel and ids; never the text, never the endpoint (docs/30 section 10).
            if (action is "notification.sent" or "notification.failed")
            {
                await AuditWriter.WriteAsync(
                    unitOfWork,
                    new AuditEvent(line.OrganizationId, "system", null, action, "notification_delivery", line.Id, $"deliver-{line.Id}",
                        new { kind, channel = NotificationRouter.Push, requestId = line.RequestId, devices = targets.Count, attempts = line.Attempts }),
                    cancellationToken);
            }

            await unitOfWork.CommitAsync(cancellationToken);
        }

        return (accepted, retried, dead, removed);
    }

    /// <summary>The kind, the payload (ids, the class name and start; never a name or a message text) and the person's devices.</summary>
    private async Task<(string Kind, byte[] Payload, List<(Guid Id, PushTarget Target)> Targets)> MessageAsync(Claimed line, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);
        string kind;
        Guid person;
        Dictionary<string, object?> payload;
        await using (var command = unitOfWork.Command(
            """
            SELECT r.kind, r.person_id, r.data::text, i.id, ct.name, s.starts_at
            FROM notifications.requests r
            LEFT JOIN notifications.inbox_items i ON i.organization_id = r.organization_id AND i.request_id = r.id
            LEFT JOIN scheduling.sessions s ON s.organization_id = r.organization_id AND s.id = (r.data ->> 'sessionId')::uuid
            LEFT JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            WHERE r.organization_id = $1 AND r.id = $2
            """,
            line.OrganizationId, line.RequestId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            kind = reader.GetString(0);
            person = reader.GetGuid(1);
            object? session = null;
            if (!await reader.IsDBNullAsync(5, cancellationToken))
            {
                session = new
                {
                    classTypeName = await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetString(4),
                    startsAt = await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken)
                };
            }

            payload = new Dictionary<string, object?>
            {
                ["kind"] = kind,
                ["organizationId"] = line.OrganizationId,
                ["inboxItemId"] = await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetGuid(3),
                ["data"] = JsonSerializer.Deserialize<JsonElement>(reader.GetString(2)),
                ["session"] = session
            };
        }

        var targets = new List<(Guid, PushTarget)>();
        await using (var command = unitOfWork.Command(
            "SELECT id, endpoint, p256dh, auth FROM notifications.push_subscriptions WHERE organization_id = $1 AND person_id = $2 ORDER BY created_at",
            line.OrganizationId, person))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                targets.Add((reader.GetGuid(0), new PushTarget(reader.GetString(1), reader.GetString(2), reader.GetString(3))));
            }
        }

        return (kind, JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions), targets);
    }

    private static Task SetAsync(UnitOfWork unitOfWork, Claimed line, string status, string? skipReason, DateTimeOffset? nextAttempt, string? error, DateTimeOffset now, CancellationToken cancellationToken) =>
        ExecuteAsync(
            unitOfWork,
            "UPDATE notifications.deliveries SET status = $3, skip_reason = $4, next_attempt_at = $5, last_error_code = $6, updated_at = $7 WHERE organization_id = $1 AND id = $2",
            cancellationToken,
            line.OrganizationId, line.Id, status, skipReason, nextAttempt, error, now);

    private static async Task ExecuteAsync(UnitOfWork unitOfWork, string sql, CancellationToken cancellationToken, params object?[] parameters)
    {
        await using var command = unitOfWork.Command(sql, parameters);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record Pending(Guid OrganizationId, Guid Id, string Kind, string TimeZone, bool PushEnabled, bool HasSubscription, QuietWindow Quiet, DateTimeOffset? ClassStartsAt);

    private sealed record Claimed(Guid OrganizationId, Guid Id, Guid RequestId, int Attempts);
}
