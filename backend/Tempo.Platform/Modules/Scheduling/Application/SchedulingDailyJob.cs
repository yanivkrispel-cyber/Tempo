using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Notifications.Application;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary>
/// The daily scheduling job (docs/29 section 11), run by the worker as the platform role across studios:
/// every live weekly class materializes one more day so the horizon stays eight weeks, and waitlist places
/// of classes that have started are closed and their people told. Safe to run twice.
/// </summary>
public sealed class SchedulingDailyJob(IDataSourceProvider dataSources, TimeProvider clock)
{
    /// <summary>Time zones the last run could not resolve; the worker logs them.</summary>
    public HashSet<string> SkippedTimeZones { get; } = new(StringComparer.Ordinal);

    public async Task<(int Sessions, int ExpiredWaitlist)> RunAsync(CancellationToken cancellationToken)
    {
        SkippedTimeZones.Clear();
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);
        var templates = new List<(Guid OrganizationId, string TimeZone, TemplateView Template)>();
        await using (var command = unitOfWork.Command(
            """
            SELECT t.organization_id, o.time_zone,
                   t.id, t.class_type_id, t.weekday, t.local_start, t.minutes, t.instructor_membership_id, t.room_id, t.capacity, t.valid_from, t.valid_until, t.version
            FROM scheduling.templates t
            JOIN organizations.organizations o ON o.id = t.organization_id
            WHERE o.status = 'active' AND (t.valid_until IS NULL OR t.valid_until >= $1)
            """,
            DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(-1)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                templates.Add((
                    reader.GetGuid(0),
                    reader.GetString(1),
                    new TemplateView(
                        reader.GetGuid(2),
                        reader.GetGuid(3),
                        reader.GetInt16(4),
                        await reader.GetFieldValueAsync<TimeOnly>(5, cancellationToken),
                        reader.GetInt32(6),
                        await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetGuid(7),
                        await reader.IsDBNullAsync(8, cancellationToken) ? null : reader.GetGuid(8),
                        reader.GetInt32(9),
                        await reader.GetFieldValueAsync<DateOnly>(10, cancellationToken),
                        await reader.IsDBNullAsync(11, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(11, cancellationToken),
                        reader.GetInt64(12))));
            }
        }

        var sessions = 0;
        foreach (var (organizationId, timeZone, template) in templates)
        {
            // One studio with a time zone this host does not know must not stop every other studio (#108).
            if (!TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out var zone))
            {
                SkippedTimeZones.Add(timeZone);
                continue;
            }

            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
            // Lock the template at the version read, so an edit cannot commit between this check and the inserts.
            // An edit waiting on the lock then rebuilds the unbooked sessions itself (review on #117).
            await using (var hold = unitOfWork.Command(
                "SELECT 1 FROM scheduling.templates WHERE organization_id = $1 AND id = $2 AND version = $3 FOR UPDATE",
                organizationId, template.Id, template.Version))
            {
                if (await hold.ExecuteScalarAsync(cancellationToken) is null)
                {
                    continue;
                }
            }

            sessions += await TimetableService.MaterializeAsync(unitOfWork, organizationId, template, zone, today, cancellationToken);
        }

        var expired = new List<(Guid OrganizationId, Guid Booking, Guid Person, Guid Session)>();
        await using (var close = unitOfWork.Command(
            """
            UPDATE scheduling.bookings b SET status = 'expired', updated_at = now(), version = b.version + 1
            FROM scheduling.sessions s
            WHERE s.organization_id = b.organization_id AND s.id = b.session_id AND b.status = 'waitlisted' AND s.starts_at <= $1
            RETURNING b.organization_id, b.id, b.person_id, b.session_id
            """,
            clock.GetUtcNow()))
        await using (var reader = await close.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                expired.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3)));
            }
        }

        foreach (var (organizationId, booking, person, session) in expired)
        {
            await NotificationRequests.WriteAsync(
                unitOfWork,
                new NotificationRequest(organizationId, person, "waitlist.expired", "booking", booking, new Dictionary<string, Guid> { ["sessionId"] = session, ["bookingId"] = booking }),
                cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return (sessions, expired.Count);
    }
}
