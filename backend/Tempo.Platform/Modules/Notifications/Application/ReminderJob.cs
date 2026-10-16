using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Notifications.Application;

public sealed record ReminderRun(int ClassTomorrow, int ClassSoon, int PassEnding, int EntriesLow);

/// <summary>
/// The reminder job (docs/30 sections 7 and 8, D-5), run by the worker as the platform role on the hourly daytime
/// schedule. Each run writes, through <see cref="NotificationRequests"/>, the reminders that are due:
/// <list type="bullet">
/// <item>class tomorrow: from the studio's send time (default 18:00) the evening before, for every booked place;</item>
/// <item>class soon: within the studio's hours before the start (default 2), unless the place was booked inside them;</item>
/// <item>pass ending: within the studio's days before the last day (default 7), unless a later pass follows or the
/// pass was never longer than that;</item>
/// <item>entries low: once per punch card, when it has the studio's number of entries left (default 1) or fewer.</item>
/// </list>
/// Only active members of active studios, never a reminder the studio turned off or the member switched off. The
/// dedupe key (the session date, the pass's last day, once per card for entries low) makes every run safe to repeat, so a missed
/// tick is caught by the next one. Quiet hours are the router's work, as for every other notification.
/// </summary>
public sealed class ReminderJob(IDataSourceProvider dataSources, TimeProvider clock)
{
    /// <summary>The last tick of the day (infrastructure: `cron(0 7-21 * * ? *)`); a later send time sends then.</summary>
    public static readonly TimeOnly LastTickLocal = new(21, 0);

    public async Task<ReminderRun> RunAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);

        var classTomorrow = await WriteAsync(unitOfWork, "reminder.class_tomorrow", "session", Due(
            """
            SELECT b.organization_id, b.person_id, s.id, b.id, s.local_date::text
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            JOIN organizations.organizations o ON o.id = b.organization_id AND o.status = 'active'
            JOIN people.people pe ON pe.organization_id = b.organization_id AND pe.id = b.person_id AND pe.status = 'active'
            JOIN organizations.memberships m ON m.organization_id = pe.organization_id AND m.id = pe.membership_id AND m.status = 'active'
            LEFT JOIN notifications.studio_settings st ON st.organization_id = b.organization_id
            WHERE b.status = 'booked' AND s.status = 'scheduled' AND coalesce(st.class_tomorrow_enabled, true)
              AND s.local_date = ($1::timestamptz AT TIME ZONE o.time_zone)::date + 1
              AND ($1::timestamptz AT TIME ZONE o.time_zone)::time >= least(coalesce(st.class_tomorrow_send_at, '18:00'), $4::time)
              AND NOT EXISTS (SELECT 1 FROM notifications.reminder_switches rs
                              WHERE rs.organization_id = b.organization_id AND rs.person_id = b.person_id AND rs.reminder = $3 AND NOT rs.enabled)
              AND NOT EXISTS (SELECT 1 FROM notifications.requests r
                              WHERE r.organization_id = b.organization_id AND r.dedupe_key = $2 || ':' || s.id || ':' || b.person_id || ':' || s.local_date::text)
            ORDER BY s.starts_at
            LIMIT 2000
            """,
            now, "reminder.class_tomorrow", "class_tomorrow", LastTickLocal), cancellationToken);

        var classSoon = await WriteAsync(unitOfWork, "reminder.class_soon", "session", Due(
            """
            SELECT b.organization_id, b.person_id, s.id, b.id, s.local_date::text
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            JOIN organizations.organizations o ON o.id = b.organization_id AND o.status = 'active'
            JOIN people.people pe ON pe.organization_id = b.organization_id AND pe.id = b.person_id AND pe.status = 'active'
            JOIN organizations.memberships m ON m.organization_id = pe.organization_id AND m.id = pe.membership_id AND m.status = 'active'
            LEFT JOIN notifications.studio_settings st ON st.organization_id = b.organization_id
            WHERE b.status = 'booked' AND s.status = 'scheduled' AND coalesce(st.class_soon_enabled, true)
              AND s.starts_at > $1 AND s.starts_at <= $1 + make_interval(hours => coalesce(st.class_soon_hours_before, 2))
              AND b.created_at <= s.starts_at - make_interval(hours => coalesce(st.class_soon_hours_before, 2))
              AND NOT EXISTS (SELECT 1 FROM notifications.reminder_switches rs
                              WHERE rs.organization_id = b.organization_id AND rs.person_id = b.person_id AND rs.reminder = $3 AND NOT rs.enabled)
              AND NOT EXISTS (SELECT 1 FROM notifications.requests r
                              WHERE r.organization_id = b.organization_id AND r.dedupe_key = $2 || ':' || s.id || ':' || b.person_id || ':' || s.local_date::text)
            ORDER BY s.starts_at
            LIMIT 2000
            """,
            now, "reminder.class_soon", "class_soon"), cancellationToken);

        var passEnding = await WriteAsync(unitOfWork, "reminder.pass_ending", "pass", Due(
            """
            SELECT p.organization_id, p.person_id, p.id, NULL::uuid, p.ends_on::text
            FROM scheduling.passes p
            JOIN organizations.organizations o ON o.id = p.organization_id AND o.status = 'active'
            JOIN people.people pe ON pe.organization_id = p.organization_id AND pe.id = p.person_id AND pe.status = 'active'
            JOIN organizations.memberships m ON m.organization_id = pe.organization_id AND m.id = pe.membership_id AND m.status = 'active'
            LEFT JOIN notifications.studio_settings st ON st.organization_id = p.organization_id
            WHERE p.status = 'active' AND coalesce(st.pass_ending_enabled, true)
              AND p.ends_on - ($1::timestamptz AT TIME ZONE o.time_zone)::date BETWEEN 0 AND coalesce(st.pass_ending_days_before, 7)
              AND p.ends_on - p.starts_on > coalesce(st.pass_ending_days_before, 7)
              AND (p.entries IS NULL OR p.entries_used < p.entries)
              AND NOT EXISTS (SELECT 1 FROM scheduling.passes n
                              WHERE n.organization_id = p.organization_id AND n.person_id = p.person_id AND n.id <> p.id
                                AND n.status = 'active' AND n.ends_on > p.ends_on AND (n.entries IS NULL OR n.entries_used < n.entries))
              AND NOT EXISTS (SELECT 1 FROM notifications.reminder_switches rs
                              WHERE rs.organization_id = p.organization_id AND rs.person_id = p.person_id AND rs.reminder = $3 AND NOT rs.enabled)
              AND NOT EXISTS (SELECT 1 FROM notifications.requests r
                              WHERE r.organization_id = p.organization_id AND r.dedupe_key = $2 || ':' || p.id || ':' || p.person_id || ':' || p.ends_on::text)
            ORDER BY p.ends_on
            LIMIT 2000
            """,
            now, "reminder.pass_ending", "pass_ending"), cancellationToken);

        var entriesLow = await WriteAsync(unitOfWork, "reminder.entries_low", "pass", Due(
            """
            SELECT p.organization_id, p.person_id, p.id, NULL::uuid, 'low'
            FROM scheduling.passes p
            JOIN organizations.organizations o ON o.id = p.organization_id AND o.status = 'active'
            JOIN people.people pe ON pe.organization_id = p.organization_id AND pe.id = p.person_id AND pe.status = 'active'
            JOIN organizations.memberships m ON m.organization_id = pe.organization_id AND m.id = pe.membership_id AND m.status = 'active'
            LEFT JOIN notifications.studio_settings st ON st.organization_id = p.organization_id
            WHERE p.status = 'active' AND p.entries IS NOT NULL AND coalesce(st.entries_low_enabled, true)
              AND p.ends_on >= ($1::timestamptz AT TIME ZONE o.time_zone)::date
              AND p.entries - p.entries_used BETWEEN 1 AND coalesce(st.entries_low_left, 1)
              AND p.entries > coalesce(st.entries_low_left, 1)
              AND NOT EXISTS (SELECT 1 FROM notifications.reminder_switches rs
                              WHERE rs.organization_id = p.organization_id AND rs.person_id = p.person_id AND rs.reminder = $3 AND NOT rs.enabled)
              AND NOT EXISTS (SELECT 1 FROM notifications.requests r
                              WHERE r.organization_id = p.organization_id
                                AND r.dedupe_key = $2 || ':' || p.id || ':' || p.person_id || ':low')
            ORDER BY p.ends_on
            LIMIT 2000
            """,
            now, "reminder.entries_low", "entries_low"), cancellationToken);

        await unitOfWork.CommitAsync(cancellationToken);
        return new ReminderRun(classTomorrow, classSoon, passEnding, entriesLow);
    }

    private static (string Sql, object[] Parameters) Due(string sql, params object[] parameters) => (sql, parameters);

    /// <summary>Reads the due rows (organization, person, subject, booking, occurrence) and writes one request each.</summary>
    private static async Task<int> WriteAsync(UnitOfWork unitOfWork, string kind, string subjectType, (string Sql, object[] Parameters) due, CancellationToken cancellationToken)
    {
        var rows = new List<(Guid OrganizationId, Guid Person, Guid Subject, Guid? Booking, string Occurrence)>();
        await using (var command = unitOfWork.Command(due.Sql, due.Parameters))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add((
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetGuid(2),
                    await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetGuid(3),
                    reader.GetString(4)));
            }
        }

        var written = 0;
        foreach (var (organizationId, person, subject, booking, occurrence) in rows)
        {
            var data = booking is { } bookingId
                ? new Dictionary<string, Guid> { ["sessionId"] = subject, ["bookingId"] = bookingId }
                : new Dictionary<string, Guid> { ["passId"] = subject };
            var item = await NotificationRequests.WriteAsync(
                unitOfWork,
                new NotificationRequest(organizationId, person, kind, subjectType, subject, data, occurrence),
                cancellationToken);
            written += item is null ? 0 : 1;
        }

        return written;
    }
}
