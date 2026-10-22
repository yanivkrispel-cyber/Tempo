using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Marketing;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary><paramref name="EntriesLeft"/> is the held punch card's remaining entries after this place; null for a membership or no pass.</summary>
/// <paramref name="HealthStatus"/> is the person's declaration status (docs/31 section 5); null when the caller lacks `people.view`.
public sealed record RosterEntryView(Guid BookingId, PersonRefView Person, string Status, int? WaitlistPosition, string? PassName, int? EntriesLeft, DateTimeOffset BookedAt, string? HealthStatus = null, bool ToPayAtStudio = false);

public sealed record RosterView(SessionView Session, IReadOnlyList<RosterEntryView> Booked, IReadOnlyList<RosterEntryView> Waitlisted);

public sealed record SessionChanges(Change<Guid?> InstructorMembershipId, Change<Guid?> RoomId, int? Capacity);

/// <summary>
/// One class as staff run it (docs/29 sections 4.2 and 6.4): its roster, attendance, editing it, cancelling it.
/// The session's own instructor may read its roster and mark attendance without the staff permissions.
/// </summary>
public interface IClassService
{
    Task<RosterView> RosterAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken);

    Task<BookingView> MarkAttendanceAsync(TenantContext tenant, Guid bookingId, string state, CancellationToken cancellationToken);

    Task<SessionView> UpdateSessionAsync(TenantContext tenant, Guid sessionId, SessionChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<SessionView> CancelSessionAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken);
}

public sealed partial class BookingService : IClassService
{
    /// <summary>Attendance opens 30 minutes before the class and closes 7 days after it (docs/29 section 6.4).</summary>
    private static readonly TimeSpan AttendanceOpensBefore = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan AttendanceClosesAfter = TimeSpan.FromDays(7);

    public async Task<RosterView> RosterAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await StaffOrInstructorAsync(unitOfWork, tenant, sessionId, Permissions.BookingsManage, cancellationToken);
        // Staff skip the instructor lookup, so an id from another studio (or none) must still answer 404, not 500 (#124).
        var session = (await TimetableService.SessionsAsync(unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = $3", cancellationToken, sessionId)).SingleOrDefault()
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
        await using var command = unitOfWork.Command(
            """
            SELECT b.id, p.id, p.display_name, b.status,
                   CASE WHEN b.status = 'waitlisted' THEN
                       (SELECT count(*)::int FROM scheduling.bookings w WHERE w.organization_id = b.organization_id AND w.session_id = b.session_id
                          AND w.status = 'waitlisted' AND w.waitlist_position <= b.waitlist_position)
                   END,
                   pp.name, ps.entries - ps.entries_used, b.created_at,
                   hd.id IS NOT NULL, hd.expires_at, hd.has_yes, hd.medical_approval_on, b.to_pay_at_studio
            FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            LEFT JOIN people.health_declarations hd ON hd.organization_id = b.organization_id AND hd.person_id = b.person_id AND hd.superseded_at IS NULL
            LEFT JOIN scheduling.pass_uses u ON u.organization_id = b.organization_id AND u.booking_id = b.id AND u.status = 'held'
            LEFT JOIN scheduling.passes ps ON ps.organization_id = u.organization_id AND ps.id = u.pass_id
            LEFT JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
            WHERE b.organization_id = $1 AND b.session_id = $2 AND b.status IN ('booked', 'attended', 'no_show', 'waitlisted')
            ORDER BY b.waitlist_position NULLS FIRST, b.created_at
            """,
            tenant.OrganizationId, sessionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var entries = new List<RosterEntryView>();
        var showHealth = tenant.Has(Permissions.PeopleView);
        var now = clock.GetUtcNow();
        while (await reader.ReadAsync(cancellationToken))
        {
            string? health = null;
            if (showHealth && !reader.GetBoolean(8))
            {
                health = HealthStatus.Missing;
            }
            else if (showHealth)
            {
                DateOnly? approval = await reader.IsDBNullAsync(11, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(11, cancellationToken);
                health = HealthStatus.Of(await reader.GetFieldValueAsync<DateTimeOffset>(9, cancellationToken), reader.GetBoolean(10), approval, now);
            }

            entries.Add(new RosterEntryView(
                reader.GetGuid(0),
                new PersonRefView(reader.GetGuid(1), reader.GetString(2)),
                reader.GetString(3),
                await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetInt32(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5),
                await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetInt32(6),
                await reader.GetFieldValueAsync<DateTimeOffset>(7, cancellationToken),
                health,
                reader.GetBoolean(12)));
        }

        return new RosterView(session, [.. entries.Where(e => e.Status != "waitlisted")], [.. entries.Where(e => e.Status == "waitlisted")]);
    }

    public async Task<BookingView> MarkAttendanceAsync(TenantContext tenant, Guid bookingId, string state, CancellationToken cancellationToken)
    {
        if (state is not ("attended" or "no_show"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "state.invalid", "Use attended or no_show.", "state");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid sessionId;
        string status;
        await using (var read = unitOfWork.Command("SELECT session_id, status FROM scheduling.bookings WHERE organization_id = $1 AND id = $2 FOR UPDATE", tenant.OrganizationId, bookingId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw BookingNotFound();
            }

            sessionId = reader.GetGuid(0);
            status = reader.GetString(1);
        }

        await StaffOrInstructorAsync(unitOfWork, tenant, sessionId, Permissions.AttendanceMark, cancellationToken);
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken);
        var now = clock.GetUtcNow();
        if (now < session.StartsAt - AttendanceOpensBefore || now > session.StartsAt + AttendanceClosesAfter)
        {
            throw Conflict("attendance.out_of_window", "Attendance opens 30 minutes before the class and closes a week after it.");
        }

        if (status is not ("booked" or "attended" or "no_show"))
        {
            throw Conflict("booking.not_cancellable", "Only booked places take attendance.");
        }

        // A no-show keeps the entry used; attendance never returns or takes an entry.
        await SetStatusAsync(unitOfWork, tenant.OrganizationId, bookingId, state, null, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "booking.attendance_marked", bookingId, new { sessionId, state }, cancellationToken);
        if (state == "attended" && status != "attended")
        {
            await AttendanceEffects.OnAttendedAsync(unitOfWork, tenant.OrganizationId, bookingId, tenant.UserAccountId, tenant.CorrelationId, cancellationToken);
        }
        var marked = (await BookingsAsync(unitOfWork, tenant.OrganizationId, "WHERE b.organization_id = $1 AND b.id = $2", cancellationToken, bookingId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return marked;
    }

    public async Task<SessionView> UpdateSessionAsync(TenantContext tenant, Guid sessionId, SessionChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (changes.Capacity is { } c && c is < 1 or > 500)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "capacity.invalid", "Use 1 to 500 places.", "capacity");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        if (session.Status == "cancelled")
        {
            throw Conflict("session.cancelled", "This class was cancelled.");
        }

        if (changes.InstructorMembershipId is { IsSet: true, Value: { } instructor })
        {
            await using var check = unitOfWork.Command(
                "SELECT 1 FROM organizations.memberships WHERE organization_id = $1 AND id = $2 AND status = 'active' AND role <> 'client'",
                tenant.OrganizationId, instructor);
            if (await check.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "instructor.invalid", "Choose an active staff member.", "instructorMembershipId");
            }
        }

        if (changes.RoomId is { IsSet: true, Value: { } room })
        {
            await using var check = unitOfWork.Command("SELECT 1 FROM scheduling.rooms WHERE organization_id = $1 AND id = $2 AND status = 'active'", tenant.OrganizationId, room);
            if (await check.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "room.invalid", "Choose an active room.", "roomId");
            }
        }

        await using (var update = unitOfWork.Command(
            """
            UPDATE scheduling.sessions
            SET instructor_membership_id = CASE WHEN $3 THEN $4 ELSE instructor_membership_id END,
                room_id = CASE WHEN $5 THEN $6 ELSE room_id END,
                capacity = coalesce($7, capacity), updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2 AND ($8::bigint IS NULL OR version = $8) AND coalesce($7, capacity) >= booked_count
            """,
            tenant.OrganizationId, sessionId, changes.InstructorMembershipId.IsSet, changes.InstructorMembershipId.Value, changes.RoomId.IsSet, changes.RoomId.Value, changes.Capacity, expectedVersion))
        {
            if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                await using var why = unitOfWork.Command("SELECT version, booked_count FROM scheduling.sessions WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, sessionId);
                await using var reader = await why.ExecuteReaderAsync(cancellationToken);
                await reader.ReadAsync(cancellationToken);
                throw expectedVersion is { } v && reader.GetInt64(0) != v
                    ? Conflict("concurrency.conflict", "Someone changed this in the meantime. Reload and try again.")
                    : Conflict("session.capacity_below_booked", $"{reader.GetInt32(1)} people are booked; capacity cannot go below that.");
            }
        }

        if (changes.Capacity is not null)
        {
            await PromoteAsync(unitOfWork, tenant, session, await PolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken), clock.GetUtcNow(), cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "session.updated", sessionId, new { instructor = changes.InstructorMembershipId.IsSet, room = changes.RoomId.IsSet, capacity = changes.Capacity }, cancellationToken, "session");
        var updated = (await TimetableService.SessionsAsync(unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = $3", cancellationToken, sessionId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<SessionView> CancelSessionAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        if (session.Status == "cancelled")
        {
            throw Conflict("session.cancelled", "This class is already cancelled.");
        }

        if (session.StartsAt <= clock.GetUtcNow())
        {
            throw Conflict("booking.closed", "This class has started.");
        }

        // Every live place is cancelled and its entry returned, whatever the window (C-8).
        var affected = new List<(Guid Booking, Guid Person)>();
        await using (var cancel = unitOfWork.Command(
            """
            UPDATE scheduling.bookings SET status = 'cancelled', cancel_reason = 'session_cancelled', updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND session_id = $2 AND status IN ('booked', 'waitlisted')
            RETURNING id, person_id
            """,
            tenant.OrganizationId, sessionId))
        await using (var reader = await cancel.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                affected.Add((reader.GetGuid(0), reader.GetGuid(1)));
            }
        }

        foreach (var (booking, person) in affected)
        {
            await ReturnEntryAsync(unitOfWork, tenant.OrganizationId, booking, cancellationToken);
            await InboxAsync(unitOfWork, tenant.OrganizationId, person, "session.cancelled", sessionId, booking, cancellationToken);
        }

        await using (var close = unitOfWork.Command(
            "UPDATE scheduling.sessions SET status = 'cancelled', booked_count = 0, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId, sessionId))
        {
            await close.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "session.cancelled", sessionId, new { bookings = affected.Count }, cancellationToken, "session");
        var cancelled = (await TimetableService.SessionsAsync(unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = $3", cancellationToken, sessionId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return cancelled;
    }

    private static async Task StaffOrInstructorAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid sessionId, string permission, CancellationToken cancellationToken)
    {
        if (tenant.Has(permission))
        {
            return;
        }

        // The instructor rule holds only while the caller is still an active staff member: a session keeps its
        // instructor_membership_id after a demotion to client or a suspension (#124).
        await using var command = unitOfWork.Command(
            """
            SELECT s.instructor_membership_id = $3
               AND EXISTS (SELECT 1 FROM organizations.memberships m
                           WHERE m.organization_id = s.organization_id AND m.id = $3 AND m.status = 'active' AND m.role <> 'client')
            FROM scheduling.sessions s
            WHERE s.organization_id = $1 AND s.id = $2
            """,
            tenant.OrganizationId, sessionId, tenant.MembershipId);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        if (result is null)
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
        }

        if (result is not true)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only staff or this class's instructor can do this.");
        }
    }
}
