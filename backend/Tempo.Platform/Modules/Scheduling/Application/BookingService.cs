using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Marketing;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Infrastructure;
using Tempo.Platform.Modules.Notifications.Application;
using Tempo.Platform.Modules.Scheduling.Domain;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record PersonRefView(Guid Id, string DisplayName);

public sealed record PassSummaryView(Guid Id, string Name, string Kind, DateOnly EndsOn, int? EntriesLeft);

/// <summary>What the caller would book a session with: the pass, or the day their frozen membership thaws (docs/29 section 16.4).</summary>
public sealed record SessionPassView(PassSummaryView? Preview, DateOnly? FrozenUntil);

public sealed record BookingView(
    Guid Id,
    Guid SessionId,
    PersonRefView Person,
    string Status,
    int? WaitlistPosition,
    bool LateCancel,
    string? CancelReason,
    PassSummaryView? Pass,
    DateTimeOffset CreatedAt,
    long Version,
    string? CancelledFrom = null,
    SpotRefView? Spot = null,
    bool ToPayAtStudio = false);

public sealed record SpotRefView(Guid Id, string Label);

public sealed record MyBookingView(BookingView Booking, SessionView Session);

public sealed record MyBookingPage(IReadOnlyList<MyBookingView> Items, Guid? NextBefore);

/// <summary>
/// Booking a place, cancelling it and the waitlist (docs/29 section 6). Capacity and entries are taken with
/// guarded updates, so concurrent bookings can neither overbook a class nor spend one entry twice.
/// </summary>
public interface IBookingService
{
    /// <summary>
    /// Books <paramref name="personId"/>, or the caller when null (the self rule). In a room with spots the place
    /// takes <paramref name="spotId"/>, or the usual or first free spot when null (docs/33 section 3.3).
    /// </summary>
    /// <summary><paramref name="sourceCode"/> is the link a member came from (docs/37 M-12), kept on their own booking only.</summary>
    Task<BookingView> BookAsync(TenantContext tenant, Guid sessionId, Guid? personId, CancellationToken cancellationToken, Guid? spotId = null, string? sourceCode = null);

    Task<BookingView> CancelAsync(TenantContext tenant, Guid bookingId, bool returnEntry, CancellationToken cancellationToken);

    /// <summary>Moves a booked place to another class (docs/29 section 16.1); staff only. Returns the new booking.</summary>
    Task<BookingView> MoveAsync(TenantContext tenant, Guid bookingId, Guid sessionId, CancellationToken cancellationToken);

    /// <summary>
    /// The desk moves a waiting person into a free place, past the waitlist cutoff and during the class (OwnerLive,
    /// LV-1); staff only. Takes <paramref name="spotId"/> in a room with spots, else her usual or the first free spot.
    /// </summary>
    Task<BookingView> PromoteAsync(TenantContext tenant, Guid bookingId, Guid? spotId, CancellationToken cancellationToken);

    Task<MyBookingPage> ListMineAsync(TenantContext tenant, bool upcoming, Guid? before, int limit, CancellationToken cancellationToken);

    Task<MyBookingPage> ListForPersonAsync(TenantContext tenant, Guid personId, bool upcoming, Guid? before, int limit, CancellationToken cancellationToken);
}

public sealed partial class BookingService(IDataSourceProvider dataSources, TimeProvider clock, IHealthDataKeys? healthKeys = null) : IBookingService
{
    /// <summary><paramref name="PassRequired"/> is false for an event booked without a pass (docs/37 section 8.4).</summary>
    private sealed record SessionFacts(Guid Id, DateOnly LocalDate, DateTimeOffset StartsAt, string Status, string Category, bool PassRequired = true);

    private sealed record Policy(int FreeCancelHours, int WaitlistCutoffHours, int HorizonDays, bool WaitlistEnabled, bool RequireHealthDeclaration);

    public async Task<BookingView> BookAsync(TenantContext tenant, Guid sessionId, Guid? personId, CancellationToken cancellationToken, Guid? spotId = null, string? sourceCode = null)
    {
        if (personId is not null && !tenant.Has(Permissions.BookingsManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You can book only for yourself.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var bookingId = await BookInAsync(unitOfWork, tenant, sessionId, personId, spotId, sourceCode, cancellationToken);
        var booking = (await BookingsAsync(unitOfWork, tenant.OrganizationId, "WHERE b.organization_id = $1 AND b.id = $2", cancellationToken, bookingId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return booking;
    }

    /// <summary>
    /// The booking itself inside the caller's transaction, so the public offer join (SK3) can join, grant and book in
    /// one: every rule of <see cref="BookAsync"/>, nothing committed here. The health gate is checked before anything
    /// is written, so a caller may catch `health.declaration_required` and still commit its own work.
    /// </summary>
    internal async Task<Guid> BookInAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid sessionId, Guid? personId, Guid? spotId, string? sourceCode, CancellationToken cancellationToken)
    {
        var person = personId ?? await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        await LivePersonAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken);
        var policy = await PolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var now = clock.GetUtcNow();
        if (session.Status == "cancelled")
        {
            throw Conflict("session.cancelled", "This class was cancelled.");
        }

        if (session.StartsAt <= now)
        {
            throw Conflict("booking.closed", "This class has started.");
        }

        if (personId is null)
        {
            var zone = await TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
            if (session.LocalDate > today.AddDays(policy.HorizonDays))
            {
                throw Conflict("booking.not_open", $"Booking opens {policy.HorizonDays} days before the class.");
            }
        }

        // The health declaration gate (docs/31 section 10, H-5): a member's own place needs `signed`; staff booking on
        // someone's behalf goes through and is audited below.
        var healthStatus = policy.RequireHealthDeclaration
            ? await HealthStatus.OfPersonAsync(unitOfWork, tenant.OrganizationId, person, now, cancellationToken)
            : HealthStatus.SignedStatus;
        if (personId is null && healthStatus != HealthStatus.SignedStatus)
        {
            throw Conflict("health.declaration_required", "Sign the studio's health declaration before booking.");
        }

        // An event without a pass (docs/37 section 8.4) holds no entry; the place is paid at the studio.
        var pass = session.PassRequired
            ? await PickPassAsync(unitOfWork, tenant.OrganizationId, person, session, lockRows: true, cancellationToken)
                ?? throw await NoValidPassAsync(unitOfWork, tenant.OrganizationId, person, session, "No punch card or membership is valid for this class.", cancellationToken)
            : null;
        var bookingId = Guid.CreateVersion7();
        try
        {
            var placed = await TakePlaceAsync(unitOfWork, tenant.OrganizationId, session.Id, cancellationToken);
            Guid? spot = null;
            if (placed)
            {
                try
                {
                    spot = await AssignSpotAsync(unitOfWork, tenant.OrganizationId, session.Id, person, spotId, cancellationToken);
                }
                catch (DomainRuleViolationException e) when (e.Code == "session.full")
                {
                    // A place is left but every spot is held or under maintenance: the class is full for this booking.
                    await ReleasePlaceAsync(unitOfWork, tenant.OrganizationId, session.Id, cancellationToken);
                    placed = false;
                }
            }

            if (placed)
            {
                await InsertBookingAsync(unitOfWork, tenant, bookingId, session.Id, person, "booked", null, cancellationToken, spot);
                await HoldOrPayAtStudioAsync(unitOfWork, tenant.OrganizationId, pass, bookingId, cancellationToken);
                await AuditAsync(unitOfWork, tenant, "booking.created", bookingId, new { sessionId = session.Id, personId = person, passId = pass?.Id, spotId = spot }, cancellationToken);
            }
            else if (policy.WaitlistEnabled && now < session.StartsAt.AddHours(-policy.WaitlistCutoffHours))
            {
                // No entry is held while waiting (C-2); it is taken on promotion.
                await using var next = unitOfWork.Command(
                    "UPDATE scheduling.sessions SET next_waitlist_position = next_waitlist_position + 1 WHERE organization_id = $1 AND id = $2 RETURNING next_waitlist_position - 1",
                    tenant.OrganizationId, session.Id);
                var position = (int)(await next.ExecuteScalarAsync(cancellationToken))!;
                await InsertBookingAsync(unitOfWork, tenant, bookingId, session.Id, person, "waitlisted", position, cancellationToken);
                await AuditAsync(unitOfWork, tenant, "booking.waitlisted", bookingId, new { sessionId = session.Id, personId = person }, cancellationToken);
            }
            else
            {
                throw Conflict("session.full", "This class is full.");
            }
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == "ux_bookings_one_live")
        {
            throw Conflict("booking.duplicate", "Already booked or waiting for this class.");
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == "ux_bookings_session_spot")
        {
            throw Conflict("booking.spot_unavailable", "Someone already holds this spot.");
        }

        if (personId is null)
        {
            await SourceLinks.MarkBookingAsync(unitOfWork, tenant.OrganizationId, bookingId, sourceCode, cancellationToken);
        }

        if (healthStatus != HealthStatus.SignedStatus)
        {
            // Staff booked someone without a signed declaration while the gate is on (H-5): allowed, and on record.
            await AuditAsync(unitOfWork, tenant, "booking.health_gate_bypassed", bookingId, new { personId = person, status = healthStatus }, cancellationToken);
        }

        return bookingId;
    }

    public async Task<BookingView> CancelAsync(TenantContext tenant, Guid bookingId, bool returnEntry, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid sessionId;
        string status;
        Guid? owner;
        await using (var read = unitOfWork.Command(
            """
            SELECT b.session_id, b.status, p.membership_id
            FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = $1 AND b.id = $2
            FOR UPDATE OF b
            """,
            tenant.OrganizationId, bookingId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw BookingNotFound();
            }

            sessionId = reader.GetGuid(0);
            status = reader.GetString(1);
            owner = await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetGuid(2);
        }

        var staff = tenant.Has(Permissions.BookingsManage);
        if (!staff && owner != tenant.MembershipId)
        {
            throw BookingNotFound();
        }

        if (returnEntry && !staff)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only staff can return an entry on a late cancellation.");
        }

        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        var now = clock.GetUtcNow();
        if (status is not ("booked" or "waitlisted") || session.StartsAt <= now)
        {
            throw Conflict("booking.not_cancellable", "This booking can no longer be cancelled.");
        }

        var policy = await PolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var late = status == "booked" && now > session.StartsAt.AddHours(-policy.FreeCancelHours);
        await using (var cancel = unitOfWork.Command(
            "UPDATE scheduling.bookings SET status = 'cancelled', cancel_reason = $3, late_cancel = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId, bookingId, owner == tenant.MembershipId ? "self" : "staff", late))
        {
            await cancel.ExecuteNonQueryAsync(cancellationToken);
        }

        if (status == "booked")
        {
            await using (var free = unitOfWork.Command(
                "UPDATE scheduling.sessions SET booked_count = booked_count - 1, version = version + 1 WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId, sessionId))
            {
                await free.ExecuteNonQueryAsync(cancellationToken);
            }

            if (!late || returnEntry)
            {
                await ReturnEntryAsync(unitOfWork, tenant.OrganizationId, bookingId, cancellationToken);
            }

            await PromoteAsync(unitOfWork, tenant, session, policy, now, cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "booking.cancelled", bookingId, new { sessionId, late, entryReturned = status == "booked" && (!late || returnEntry) }, cancellationToken);
        var cancelled = (await BookingsAsync(unitOfWork, tenant.OrganizationId, "WHERE b.organization_id = $1 AND b.id = $2", cancellationToken, bookingId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return cancelled;
    }

    public async Task<BookingView> MoveAsync(TenantContext tenant, Guid bookingId, Guid sessionId, CancellationToken cancellationToken)
    {
        if (!tenant.Has(Permissions.BookingsManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only staff can move a booking.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid fromSessionId;
        Guid personId;
        string status;
        await using (var read = unitOfWork.Command(
            "SELECT session_id, person_id, status FROM scheduling.bookings WHERE organization_id = $1 AND id = $2 FOR UPDATE",
            tenant.OrganizationId, bookingId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw BookingNotFound();
            }

            fromSessionId = reader.GetGuid(0);
            personId = reader.GetGuid(1);
            status = reader.GetString(2);
        }

        if (fromSessionId == sessionId)
        {
            throw Conflict("booking.duplicate", "The booking is already in this class.");
        }

        if (status != "booked")
        {
            throw Conflict("booking.not_cancellable", "Only a booked place can be moved.");
        }

        // Both classes are locked in id order, so two staff moving across each other cannot deadlock.
        SessionFacts from;
        SessionFacts to;
        if (fromSessionId.CompareTo(sessionId) < 0)
        {
            from = await SessionAsync(unitOfWork, tenant.OrganizationId, fromSessionId, cancellationToken, forUpdate: true);
            to = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        }
        else
        {
            to = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
            from = await SessionAsync(unitOfWork, tenant.OrganizationId, fromSessionId, cancellationToken, forUpdate: true);
        }

        var now = clock.GetUtcNow();
        if (from.StartsAt <= now || to.StartsAt <= now)
        {
            throw Conflict("booking.closed", "This class has started.");
        }

        if (to.Status == "cancelled")
        {
            throw Conflict("session.cancelled", "This class was cancelled.");
        }

        if (!from.PassRequired || !to.PassRequired)
        {
            throw Conflict("booking.move_event", "Places at an event without a pass are not moved; cancel and book instead.");
        }

        // The entry comes back and is held again for the new class inside this transaction: once it commits
        // nothing was spent or returned, and a pass that does not cover the new class rolls the whole move back.
        await ReturnEntryAsync(unitOfWork, tenant.OrganizationId, bookingId, cancellationToken);
        var pass = await PickPassAsync(unitOfWork, tenant.OrganizationId, personId, to, lockRows: true, cancellationToken)
            ?? throw await NoValidPassAsync(unitOfWork, tenant.OrganizationId, personId, to, "No punch card or membership is valid for the new class.", cancellationToken);
        if (!await TakePlaceAsync(unitOfWork, tenant.OrganizationId, to.Id, cancellationToken))
        {
            throw Conflict("session.full", "This class is full.");
        }

        var movedId = Guid.CreateVersion7();
        var movedSpot = await AssignSpotAsync(unitOfWork, tenant.OrganizationId, to.Id, personId, null, cancellationToken);
        try
        {
            await InsertBookingAsync(unitOfWork, tenant, movedId, to.Id, personId, "booked", null, cancellationToken, movedSpot);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == "ux_bookings_one_live")
        {
            throw Conflict("booking.duplicate", "Already booked or waiting for this class.");
        }

        await HoldEntryAsync(unitOfWork, tenant.OrganizationId, pass, movedId, cancellationToken);
        await SetStatusAsync(unitOfWork, tenant.OrganizationId, bookingId, "cancelled", "moved", cancellationToken);
        await using (var free = unitOfWork.Command(
            "UPDATE scheduling.sessions SET booked_count = booked_count - 1, version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId, from.Id))
        {
            await free.ExecuteNonQueryAsync(cancellationToken);
        }

        await PromoteAsync(unitOfWork, tenant, from, await PolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken), now, cancellationToken);
        await InboxAsync(unitOfWork, tenant.OrganizationId, personId, "booking.moved", to.Id, movedId, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "booking.moved", movedId, new { fromSessionId = from.Id, toSessionId = to.Id, previousBookingId = bookingId, personId, passId = pass.Id }, cancellationToken);
        var moved = (await BookingsAsync(unitOfWork, tenant.OrganizationId, "WHERE b.organization_id = $1 AND b.id = $2", cancellationToken, movedId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return moved;
    }

    public async Task<BookingView> PromoteAsync(TenantContext tenant, Guid bookingId, Guid? spotId, CancellationToken cancellationToken)
    {
        if (!tenant.Has(Permissions.BookingsManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only the desk can move a waiting person into a place.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid sessionId;
        Guid personId;
        string status;
        await using (var read = unitOfWork.Command(
            "SELECT session_id, person_id, status FROM scheduling.bookings WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId, bookingId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw BookingNotFound();
            }

            sessionId = reader.GetGuid(0);
            personId = reader.GetGuid(1);
            status = reader.GetString(2);
        }

        // The class first, then the booking, in the order every other path locks them.
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        await using (var hold = unitOfWork.Command(
            "SELECT status FROM scheduling.bookings WHERE organization_id = $1 AND id = $2 FOR UPDATE",
            tenant.OrganizationId, bookingId))
        {
            status = await hold.ExecuteScalarAsync(cancellationToken) as string ?? status;
        }

        if (status != "waitlisted")
        {
            throw Conflict("booking.not_waitlisted", "Only a waiting person can be moved into a place.");
        }

        if (session.Status == "cancelled")
        {
            throw Conflict("session.cancelled", "This class was cancelled.");
        }

        var now = clock.GetUtcNow();
        await using (var ends = unitOfWork.Command("SELECT ends_at FROM scheduling.sessions WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, sessionId))
        {
            if (await ends.ExecuteScalarAsync(cancellationToken) is DateTime endsAt && endsAt <= now.UtcDateTime)
            {
                throw Conflict("booking.closed", "This class has ended.");
            }
        }

        if (!await TakePlaceAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken))
        {
            throw Conflict("session.full", "This class is full.");
        }

        // A desk call never cancels her: with no valid pass the whole transaction rolls back and she keeps waiting.
        var pass = session.PassRequired
            ? await PickPassAsync(unitOfWork, tenant.OrganizationId, personId, session, lockRows: true, cancellationToken)
                ?? throw await NoValidPassAsync(unitOfWork, tenant.OrganizationId, personId, session, "No punch card or membership is valid for this class.", cancellationToken)
            : null;
        var spot = await AssignSpotAsync(unitOfWork, tenant.OrganizationId, sessionId, personId, spotId, cancellationToken);
        await SetStatusAsync(unitOfWork, tenant.OrganizationId, bookingId, "booked", null, cancellationToken);
        if (spot is not null)
        {
            await using var place = unitOfWork.Command(
                "UPDATE scheduling.bookings SET spot_id = $3 WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId, bookingId, spot);
            await place.ExecuteNonQueryAsync(cancellationToken);
        }

        await HoldOrPayAtStudioAsync(unitOfWork, tenant.OrganizationId, pass, bookingId, cancellationToken);
        await InboxAsync(unitOfWork, tenant.OrganizationId, personId, "booking.promoted", sessionId, bookingId, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "booking.promoted", bookingId, new { sessionId, passId = pass?.Id, spotId = spot, by = "staff" }, cancellationToken);
        var promoted = (await BookingsAsync(unitOfWork, tenant.OrganizationId, "WHERE b.organization_id = $1 AND b.id = $2", cancellationToken, bookingId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return promoted;
    }

    public async Task<MyBookingPage> ListMineAsync(TenantContext tenant, bool upcoming, Guid? before, int limit, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        return await PageAsync(unitOfWork, tenant, person, upcoming, before, limit, cancellationToken);
    }

    public async Task<MyBookingPage> ListForPersonAsync(TenantContext tenant, Guid personId, bool upcoming, Guid? before, int limit, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LivePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken, anyStatus: true);
        return await PageAsync(unitOfWork, tenant, personId, upcoming, before, limit, cancellationToken);
    }

    /// <summary>Promotes from a session's waitlist after a seat was freed outside this service (a person merge).</summary>
    internal static async Task PromoteSessionAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid sessionId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        if (session.Status == "scheduled")
        {
            await PromoteAsync(unitOfWork, tenant, session, await PolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken), now, cancellationToken);
        }
    }

    /// <summary>
    /// Fills freed places from the waitlist in line order while the cutoff allows (docs/29 section 6.3). A
    /// waiter with no valid pass at that moment is skipped and told why.
    /// </summary>
    private static async Task PromoteAsync(UnitOfWork unitOfWork, TenantContext tenant, SessionFacts session, Policy policy, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (now >= session.StartsAt.AddHours(-policy.WaitlistCutoffHours))
        {
            return;
        }

        while (true)
        {
            Guid bookingId;
            Guid personId;
            await using (var next = unitOfWork.Command(
                """
                SELECT id, person_id FROM scheduling.bookings
                WHERE organization_id = $1 AND session_id = $2 AND status = 'waitlisted'
                ORDER BY waitlist_position
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """,
                tenant.OrganizationId, session.Id))
            await using (var reader = await next.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                {
                    return;
                }

                bookingId = reader.GetGuid(0);
                personId = reader.GetGuid(1);
            }

            if (!await TakePlaceAsync(unitOfWork, tenant.OrganizationId, session.Id, cancellationToken))
            {
                return;
            }

            var pass = session.PassRequired ? await PickPassAsync(unitOfWork, tenant.OrganizationId, personId, session, lockRows: true, cancellationToken) : null;
            if (pass is null && session.PassRequired)
            {
                await using (var undo = unitOfWork.Command(
                    "UPDATE scheduling.sessions SET booked_count = booked_count - 1 WHERE organization_id = $1 AND id = $2",
                    tenant.OrganizationId, session.Id))
                {
                    await undo.ExecuteNonQueryAsync(cancellationToken);
                }

                await SetStatusAsync(unitOfWork, tenant.OrganizationId, bookingId, "cancelled", "no_valid_pass", cancellationToken);
                await InboxAsync(unitOfWork, tenant.OrganizationId, personId, "booking.promotion_failed", session.Id, bookingId, cancellationToken);
                await AuditAsync(unitOfWork, tenant, "booking.cancelled", bookingId, new { sessionId = session.Id, reason = "no_valid_pass" }, cancellationToken);
                continue;
            }

            Guid? spot;
            try
            {
                spot = await AssignSpotAsync(unitOfWork, tenant.OrganizationId, session.Id, personId, null, cancellationToken);
            }
            catch (DomainRuleViolationException e) when (e.Code == "session.full")
            {
                // Every spot is held (capacity above the room's spots): the place goes back and the line waits.
                await ReleasePlaceAsync(unitOfWork, tenant.OrganizationId, session.Id, cancellationToken);
                return;
            }

            await SetStatusAsync(unitOfWork, tenant.OrganizationId, bookingId, "booked", null, cancellationToken);
            if (spot is not null)
            {
                await using var place = unitOfWork.Command(
                    "UPDATE scheduling.bookings SET spot_id = $3 WHERE organization_id = $1 AND id = $2",
                    tenant.OrganizationId, bookingId, spot);
                await place.ExecuteNonQueryAsync(cancellationToken);
            }

            await HoldOrPayAtStudioAsync(unitOfWork, tenant.OrganizationId, pass, bookingId, cancellationToken);
            await InboxAsync(unitOfWork, tenant.OrganizationId, personId, "booking.promoted", session.Id, bookingId, cancellationToken);
            await AuditAsync(unitOfWork, tenant, "booking.promoted", bookingId, new { sessionId = session.Id, passId = pass?.Id }, cancellationToken);
        }
    }

    /// <summary>The pass the next booking of the caller would use, for the booking sheet (`passPreview`).</summary>
    internal static async Task<IReadOnlyDictionary<Guid, SessionPassView>> PreviewAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid membershipId,
        IReadOnlyList<(Guid SessionId, DateOnly LocalDate, string Category)> sessions,
        CancellationToken cancellationToken)
    {
        if (sessions.Count == 0)
        {
            return new Dictionary<Guid, SessionPassView>();
        }

        await using var me = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", organizationId, membershipId);
        if (await me.ExecuteScalarAsync(cancellationToken) is not Guid person)
        {
            return new Dictionary<Guid, SessionPassView>();
        }

        var candidates = await CandidatesAsync(unitOfWork, organizationId, person, sessions.Min(s => s.LocalDate), cancellationToken);
        var previews = new Dictionary<Guid, SessionPassView>();
        foreach (var (sessionId, date, category) in sessions)
        {
            var pick = PassSelection.Pick(candidates, date, category);
            // The sheet warns before the 409 when the caller's membership is frozen on that day (docs/29 section 16.4).
            var frozenUntil = pick is null ? PassSelection.FrozenUntil(candidates, date, category) : null;
            if (pick is not null || frozenUntil is not null)
            {
                previews[sessionId] = new SessionPassView(pick is null ? null : new PassSummaryView(pick.Id, pick.Name, pick.Kind, pick.EndsOn, pick.EntriesLeft), frozenUntil);
            }
        }

        return previews;
    }

    /// <summary>
    /// 409 booking.no_valid_pass; when the person's membership is frozen on that day the Problem says until when
    /// (`frozenUntil`), so the apps can explain instead of guessing.
    /// </summary>
    private static async Task<DomainRuleViolationException> NoValidPassAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, SessionFacts session, string message, CancellationToken cancellationToken)
    {
        var until = PassSelection.FrozenUntil(await CandidatesAsync(unitOfWork, organizationId, personId, session.LocalDate, cancellationToken), session.LocalDate, session.Category);
        return new DomainRuleViolationException(ViolationKind.Conflict, "booking.no_valid_pass", message)
        {
            Extensions = until is { } u ? new Dictionary<string, object?> { ["frozenUntil"] = u } : null
        };
    }

    private static async Task<PassCandidate?> PickPassAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, SessionFacts session, bool lockRows, CancellationToken cancellationToken)
    {
        if (lockRows)
        {
            // Lock first, then read in a new statement, so the counts below see what a concurrent booking committed.
            await using var lockPasses = unitOfWork.Command(
                "SELECT id FROM scheduling.passes WHERE organization_id = $1 AND person_id = $2 AND status = 'active' AND ends_on >= $3 ORDER BY id FOR UPDATE",
                organizationId, personId, session.LocalDate);
            await using var reader = await lockPasses.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                // Only the lock matters.
            }
        }

        return PassSelection.Pick(await CandidatesAsync(unitOfWork, organizationId, personId, session.LocalDate, cancellationToken), session.LocalDate, session.Category);
    }

    private static async Task<List<PassCandidate>> CandidatesAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, DateOnly from, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT ps.id, pp.name, pp.kind, ps.starts_on, ps.ends_on, ps.entries, ps.entries_used, pp.weekly_cap, pp.class_category,
                   coalesce(ARRAY(
                       SELECT s.local_date FROM scheduling.pass_uses u
                       JOIN scheduling.bookings b ON b.organization_id = u.organization_id AND b.id = u.booking_id
                       JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
                       WHERE u.organization_id = ps.organization_id AND u.pass_id = ps.id AND u.status = 'held'), '{}'),
                   coalesce(ARRAY(SELECT f.starts_on FROM scheduling.pass_freezes f WHERE f.organization_id = ps.organization_id AND f.pass_id = ps.id ORDER BY f.starts_on), '{}'),
                   coalesce(ARRAY(SELECT f.ends_on FROM scheduling.pass_freezes f WHERE f.organization_id = ps.organization_id AND f.pass_id = ps.id ORDER BY f.starts_on), '{}')
            FROM scheduling.passes ps
            JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
            WHERE ps.organization_id = $1 AND ps.person_id = $2 AND ps.status = 'active' AND ps.ends_on >= $3
            """,
            organizationId, personId, from);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var candidates = new List<PassCandidate>();
        while (await reader.ReadAsync(cancellationToken))
        {
            candidates.Add(new PassCandidate(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                await reader.GetFieldValueAsync<DateOnly>(3, cancellationToken),
                await reader.GetFieldValueAsync<DateOnly>(4, cancellationToken),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetInt32(5),
                reader.GetInt32(6),
                await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetInt32(7),
                await reader.IsDBNullAsync(8, cancellationToken) ? null : reader.GetString(8),
                await reader.GetFieldValueAsync<DateOnly[]>(9, cancellationToken),
                [.. (await reader.GetFieldValueAsync<DateOnly[]>(10, cancellationToken)).Zip(await reader.GetFieldValueAsync<DateOnly[]>(11, cancellationToken))]));
        }

        return candidates;
    }

    private static async Task<bool> TakePlaceAsync(UnitOfWork unitOfWork, Guid organizationId, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var take = unitOfWork.Command(
            """
            UPDATE scheduling.sessions SET booked_count = booked_count + 1, version = version + 1
            WHERE organization_id = $1 AND id = $2 AND status = 'scheduled' AND booked_count < capacity
            """,
            organizationId, sessionId);
        return await take.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private static async Task ReleasePlaceAsync(UnitOfWork unitOfWork, Guid organizationId, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var release = unitOfWork.Command(
            "UPDATE scheduling.sessions SET booked_count = booked_count - 1 WHERE organization_id = $1 AND id = $2",
            organizationId, sessionId);
        await release.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>The pass's entry for a class; for an event without a pass, the place is marked to pay at the studio (M-8).</summary>
    private static async Task HoldOrPayAtStudioAsync(UnitOfWork unitOfWork, Guid organizationId, PassCandidate? pass, Guid bookingId, CancellationToken cancellationToken)
    {
        if (pass is not null)
        {
            await HoldEntryAsync(unitOfWork, organizationId, pass, bookingId, cancellationToken);
            return;
        }

        await using var mark = unitOfWork.Command(
            "UPDATE scheduling.bookings SET to_pay_at_studio = true WHERE organization_id = $1 AND id = $2",
            organizationId, bookingId);
        await mark.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task HoldEntryAsync(UnitOfWork unitOfWork, Guid organizationId, PassCandidate pass, Guid bookingId, CancellationToken cancellationToken)
    {
        if (pass.Entries is not null)
        {
            await using var spend = unitOfWork.Command(
                "UPDATE scheduling.passes SET entries_used = entries_used + 1, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2 AND entries_used < entries",
                organizationId, pass.Id);
            if (await spend.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                throw Conflict("booking.no_valid_pass", "No punch card or membership is valid for this class.");
            }
        }

        await using var use = unitOfWork.Command(
            "INSERT INTO scheduling.pass_uses (organization_id, id, pass_id, booking_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'held', now(), now())",
            organizationId, Guid.CreateVersion7(), pass.Id, bookingId);
        await use.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Gives a booking's held entry back to its punch card; a membership has nothing to return. Erase and merge use it too.</summary>
    internal static async Task ReturnEntryAsync(UnitOfWork unitOfWork, Guid organizationId, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var returned = unitOfWork.Command(
            """
            WITH used AS (
                UPDATE scheduling.pass_uses SET status = 'returned', updated_at = now(), version = version + 1
                WHERE organization_id = $1 AND booking_id = $2 AND status = 'held'
                RETURNING pass_id
            )
            UPDATE scheduling.passes ps SET entries_used = entries_used - 1, updated_at = now(), version = version + 1
            FROM used WHERE ps.organization_id = $1 AND ps.id = used.pass_id AND ps.entries IS NOT NULL
            """,
            organizationId, bookingId);
        await returned.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertBookingAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid id, Guid sessionId, Guid personId, string status, int? position, CancellationToken cancellationToken, Guid? spotId = null)
    {
        await using var insert = unitOfWork.Command(
            """
            INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, waitlist_position, booked_by, created_at, updated_at, spot_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8)
            """,
            tenant.OrganizationId, id, sessionId, personId, status, position, tenant.MembershipId, spotId);
        await insert.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task SetStatusAsync(UnitOfWork unitOfWork, Guid organizationId, Guid bookingId, string status, string? reason, CancellationToken cancellationToken)
    {
        await using var update = unitOfWork.Command(
            "UPDATE scheduling.bookings SET status = $3, cancel_reason = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            organizationId, bookingId, status, reason);
        await update.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InboxAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, string kind, Guid sessionId, Guid bookingId, CancellationToken cancellationToken)
    {
        await NotificationRequests.WriteAsync(
            unitOfWork,
            new NotificationRequest(organizationId, personId, kind, "booking", bookingId, new Dictionary<string, Guid> { ["sessionId"] = sessionId, ["bookingId"] = bookingId }),
            cancellationToken);
    }

    private async Task<MyBookingPage> PageAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid personId, bool upcoming, Guid? before, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 100);
        var filter = upcoming
            ? $"s.starts_at > $4 AND b.status IN ('booked', 'waitlisted')"
            : $"(s.starts_at <= $4 OR b.status NOT IN ('booked', 'waitlisted'))";
        var bookings = await BookingsAsync(
            unitOfWork,
            tenant.OrganizationId,
            $"""
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND {filter}
              AND ($3::uuid IS NULL OR (s.starts_at, b.id) {(upcoming ? ">" : "<")} (
                  SELECT s2.starts_at, b2.id FROM scheduling.bookings b2
                  JOIN scheduling.sessions s2 ON s2.organization_id = b2.organization_id AND s2.id = b2.session_id
                  WHERE b2.organization_id = $1 AND b2.id = $3))
            ORDER BY s.starts_at {(upcoming ? "ASC" : "DESC")}, b.id {(upcoming ? "ASC" : "DESC")}
            LIMIT $5
            """,
            cancellationToken,
            personId, before, clock.GetUtcNow(), limit + 1);
        var page = bookings.Take(limit).ToList();
        var sessions = (await TimetableService.SessionsAsync(
                unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = ANY($3)", cancellationToken, page.Select(b => b.SessionId).Distinct().ToArray()))
            .ToDictionary(s => s.Id);
        var items = page.Select(b => new MyBookingView(b, sessions[b.SessionId])).ToList();
        return new MyBookingPage(items, bookings.Count > limit ? page[^1].Id : null);
    }

    private static async Task<IReadOnlyList<BookingView>> BookingsAsync(UnitOfWork unitOfWork, Guid organizationId, string where, CancellationToken cancellationToken, params object?[] more)
    {
        await using var command = unitOfWork.Command(
            $"""
            SELECT b.id, b.session_id, p.id, p.display_name, b.status,
                   CASE WHEN b.status = 'waitlisted' THEN
                       (SELECT count(*)::int FROM scheduling.bookings w WHERE w.organization_id = b.organization_id AND w.session_id = b.session_id
                          AND w.status = 'waitlisted' AND w.waitlist_position <= b.waitlist_position)
                   END,
                   b.late_cancel, b.cancel_reason,
                   ps.id, pp.name, pp.kind, ps.ends_on, ps.entries - ps.entries_used,
                   b.created_at, b.version,
                   CASE WHEN b.status = 'cancelled' THEN CASE WHEN u.pass_id IS NULL THEN 'waitlisted' ELSE 'booked' END END,
                   rs.id, rs.label, b.to_pay_at_studio
            FROM scheduling.bookings b
            LEFT JOIN scheduling.room_spots rs ON rs.organization_id = b.organization_id AND rs.id = b.spot_id
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            LEFT JOIN scheduling.pass_uses u ON u.organization_id = b.organization_id AND u.booking_id = b.id
            LEFT JOIN scheduling.passes ps ON ps.organization_id = u.organization_id AND ps.id = u.pass_id
            LEFT JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
            {where}
            """,
            [organizationId, .. more]);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var bookings = new List<BookingView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            PassSummaryView? pass = null;
            if (!await reader.IsDBNullAsync(8, cancellationToken))
            {
                pass = new PassSummaryView(
                    reader.GetGuid(8),
                    reader.GetString(9),
                    reader.GetString(10),
                    await reader.GetFieldValueAsync<DateOnly>(11, cancellationToken),
                    await reader.IsDBNullAsync(12, cancellationToken) ? null : reader.GetInt32(12));
            }

            bookings.Add(new BookingView(
                reader.GetGuid(0),
                reader.GetGuid(1),
                new PersonRefView(reader.GetGuid(2), reader.GetString(3)),
                reader.GetString(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetInt32(5),
                reader.GetBoolean(6),
                await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetString(7),
                pass,
                await reader.GetFieldValueAsync<DateTimeOffset>(13, cancellationToken),
                reader.GetInt64(14),
                await reader.IsDBNullAsync(15, cancellationToken) ? null : reader.GetString(15),
                await reader.IsDBNullAsync(16, cancellationToken) ? null : new SpotRefView(reader.GetGuid(16), reader.GetString(17)),
                reader.GetBoolean(18)));
        }

        return bookings;
    }

    private static async Task<SessionFacts> SessionAsync(UnitOfWork unitOfWork, Guid organizationId, Guid sessionId, CancellationToken cancellationToken, bool forUpdate = false)
    {
        await using var command = unitOfWork.Command(
            $"""
            SELECT s.id, s.local_date, s.starts_at, s.status, ct.category, s.pass_required
            FROM scheduling.sessions s
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            WHERE s.organization_id = $1 AND s.id = $2
            {(forUpdate ? "FOR UPDATE OF s" : "")}
            """,
            organizationId, sessionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
        }

        return new SessionFacts(
            reader.GetGuid(0),
            await reader.GetFieldValueAsync<DateOnly>(1, cancellationToken),
            await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetBoolean(5));
    }

    private static async Task<Policy> PolicyAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT coalesce(p.free_cancel_hours, 6), coalesce(p.waitlist_cutoff_hours, 2), coalesce(p.booking_horizon_days, 14), coalesce(p.waitlist_enabled, true),
                   coalesce(p.require_health_declaration, false)
            FROM (SELECT 1) one
            LEFT JOIN scheduling.booking_policies p ON p.organization_id = $1
            """,
            organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return new Policy(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetBoolean(3), reader.GetBoolean(4));
    }

    private static async Task<Guid> MyPersonIdAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2 AND status = 'active'",
            tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid id
            ? id
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Your record in this studio was not found.");
    }

    private static async Task LivePersonAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken, bool anyStatus = false)
    {
        await using var command = unitOfWork.Command("SELECT status FROM people.people WHERE organization_id = $1 AND id = $2", organizationId, personId);
        var status = await command.ExecuteScalarAsync(cancellationToken) as string
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Person not found.");
        if (!anyStatus && status != "active")
        {
            throw Conflict("person.read_only", "Book for active people only.");
        }
    }

    private static DomainRuleViolationException BookingNotFound() => new(ViolationKind.NotFound, "booking.not_found", "Booking not found.");

    private static DomainRuleViolationException Conflict(string code, string message) => new(ViolationKind.Conflict, code, message);

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid targetId, object data, CancellationToken cancellationToken, string targetType = "booking") =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, targetType, targetId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
