using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary>
/// The daily scheduling job (docs/29 section 11), run by the worker as the platform role across studios:
/// every live weekly class materializes one more day so the horizon stays eight weeks, and waitlist places
/// of classes that have started are closed and their people told. Safe to run twice.
/// </summary>
public sealed class SchedulingDailyJob(IDataSourceProvider dataSources, TimeProvider clock)
{
    public async Task<(int Sessions, int ExpiredWaitlist)> RunAsync(CancellationToken cancellationToken)
    {
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
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
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
            await using var inbox = unitOfWork.Command(
                "INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, created_at) VALUES ($1, $2, $3, 'waitlist.expired', jsonb_build_object('sessionId', $4::uuid, 'bookingId', $5::uuid), now())",
                organizationId, Guid.CreateVersion7(), person, session, booking);
            await inbox.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return (sessions, expired.Count);
    }
}
