using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record SpotView(Guid Id, string Label, int Row, int Col, string Kind, string Status);

public sealed record RoomLayoutView(Guid RoomId, bool SpotSelection, int? Rows, int? Cols, string? WindowSide, bool MirrorFront, IReadOnlyList<SpotView> Spots, long Version);

/// <summary>One spot of a new layout; <paramref name="Id"/> keeps an existing spot (and its bookings), null adds one.</summary>
public sealed record SpotInput(Guid? Id, string? Label, int? Row, int? Col, string? Kind, string? Status);

public sealed record RoomLayoutInput(bool SpotSelection, int? Rows, int? Cols, string? WindowSide, bool MirrorFront, IReadOnlyList<SpotInput> Spots);

/// <summary>
/// One spot as the caller may see it (docs/33 section 3.4). <paramref name="State"/> is free, taken, mine or
/// maintenance, or buddy when a buddy of the caller holds it (D18). <paramref name="Person"/>, <paramref name="Attendance"/>
/// and <paramref name="HealthStatus"/> are filled for staff and the class's instructor; a member sees only a buddy's
/// name, never who else holds a spot (X-4).
/// </summary>
public sealed record SessionSpotView(
    Guid Id,
    string Label,
    int Row,
    int Col,
    string Kind,
    string State,
    Guid? BookingId = null,
    PersonRefView? Person = null,
    string? Attendance = null,
    string? HealthStatus = null,
    Guid? AvatarMediaId = null);

public sealed record SessionSpotsView(
    Guid SessionId,
    Guid? RoomId,
    bool SpotSelection,
    int? Rows,
    int? Cols,
    string? WindowSide,
    bool MirrorFront,
    Guid? MySpotId,
    Guid? UsualSpotId,
    IReadOnlyList<SessionSpotView> Spots);

/// <summary>Rooms with spots, the spot of a booking and the usual spot (docs/33 section 3).</summary>
public interface ISpotService
{
    Task<RoomLayoutView> LayoutAsync(TenantContext tenant, Guid roomId, CancellationToken cancellationToken);

    Task<RoomLayoutView> SaveLayoutAsync(TenantContext tenant, Guid roomId, RoomLayoutInput input, CancellationToken cancellationToken);

    Task<SessionSpotsView> SessionSpotsAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken);

    Task<BookingView> ChangeSpotAsync(TenantContext tenant, Guid bookingId, Guid spotId, CancellationToken cancellationToken);

    /// <summary>Sets or clears (<paramref name="spotId"/> null) the caller's usual spot in a room.</summary>
    Task SetUsualSpotAsync(TenantContext tenant, Guid roomId, Guid? spotId, CancellationToken cancellationToken);
}

public sealed partial class BookingService : ISpotService
{
    private static readonly string[] SpotKinds = ["reformer", "mat", "bike", "tower", "chair", "place"];

    public async Task<RoomLayoutView> LayoutAsync(TenantContext tenant, Guid roomId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadLayoutAsync(unitOfWork, tenant.OrganizationId, roomId, cancellationToken);
    }

    public async Task<RoomLayoutView> SaveLayoutAsync(TenantContext tenant, Guid roomId, RoomLayoutInput input, CancellationToken cancellationToken)
    {
        var spots = ValidateLayout(input);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var lockRoom = unitOfWork.Command("SELECT 1 FROM scheduling.rooms WHERE organization_id = $1 AND id = $2 FOR UPDATE", tenant.OrganizationId, roomId))
        {
            if (await lockRoom.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "room.not_found", "Room not found.");
            }
        }

        var now = clock.GetUtcNow();
        var existing = (await ReadLayoutAsync(unitOfWork, tenant.OrganizationId, roomId, cancellationToken, includeArchived: true)).Spots.ToDictionary(s => s.Id);
        if (spots.FirstOrDefault(s => s.Id is { } id && !existing.ContainsKey(id)) is { } stranger)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "spot.not_found", $"Spot {stranger.Label} is not in this room.", "spots");
        }

        // A spot that leaves service (archived, or under maintenance) must not hold a place in a future class.
        var leaving = existing.Values
            .Where(s => s.Status != "archived")
            .Where(s => spots.FirstOrDefault(n => n.Id == s.Id) is not { } kept || kept.Status != "active")
            .Select(s => s.Id)
            .ToArray();
        if (leaving.Length > 0)
        {
            await using var held = unitOfWork.Command(
                """
                SELECT rs.label FROM scheduling.bookings b
                JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
                JOIN scheduling.room_spots rs ON rs.organization_id = b.organization_id AND rs.id = b.spot_id
                WHERE b.organization_id = $1 AND b.spot_id = ANY($2) AND b.status = 'booked' AND s.starts_at > $3
                LIMIT 1
                """,
                tenant.OrganizationId, leaving, now);
            if (await held.ExecuteScalarAsync(cancellationToken) is string label)
            {
                throw Conflict("room.spot_in_use", $"Spot {label} holds a place in a future class; move that booking first.");
            }
        }

        // Every spot of the room steps aside first, so labels and cells can trade places in one save.
        await using (var aside = unitOfWork.Command(
            "UPDATE scheduling.room_spots SET status = 'archived', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND room_id = $2 AND status <> 'archived'",
            tenant.OrganizationId, roomId))
        {
            await aside.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var spot in spots)
        {
            await using var write = spot.Id is { } id
                ? unitOfWork.Command(
                    "UPDATE scheduling.room_spots SET label = $3, row_index = $4, col_index = $5, kind = $6, status = $7, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                    tenant.OrganizationId, id, spot.Label!, (short)spot.Row!.Value, (short)spot.Col!.Value, spot.Kind!, spot.Status!)
                : unitOfWork.Command(
                    """
                    INSERT INTO scheduling.room_spots (organization_id, room_id, id, label, row_index, col_index, kind, status, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
                    """,
                    tenant.OrganizationId, roomId, Guid.CreateVersion7(), spot.Label!, (short)spot.Row!.Value, (short)spot.Col!.Value, spot.Kind!, spot.Status!);
            await write.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var room = unitOfWork.Command(
            """
            UPDATE scheduling.rooms SET spot_selection = $3, layout_rows = $4, layout_cols = $5, window_side = $6, mirror_front = $7, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            """,
            tenant.OrganizationId, roomId, input.SpotSelection, (short?)input.Rows, (short?)input.Cols, input.WindowSide, input.MirrorFront))
        {
            await room.ExecuteNonQueryAsync(cancellationToken);
        }

        await PlaceFutureBookingsAsync(unitOfWork, tenant.OrganizationId, roomId, input.SpotSelection, spots.Count(s => s.Status == "active"), now, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "room.layout_updated", roomId, new { spotSelection = input.SpotSelection, spots = spots.Count, active = spots.Count(s => s.Status == "active") }, cancellationToken, "room");
        var saved = await ReadLayoutAsync(unitOfWork, tenant.OrganizationId, roomId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return saved;
    }

    public async Task<SessionSpotsView> SessionSpotsAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid? roomId;
        await using (var read = unitOfWork.Command("SELECT room_id FROM scheduling.sessions WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, sessionId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
            }

            roomId = await reader.IsDBNullAsync(0, cancellationToken) ? null : reader.GetGuid(0);
        }

        if (roomId is not { } room)
        {
            return new SessionSpotsView(sessionId, null, false, null, null, null, false, null, null, []);
        }

        var layout = await ReadLayoutAsync(unitOfWork, tenant.OrganizationId, room, cancellationToken);
        if (!layout.SpotSelection)
        {
            return new SessionSpotsView(sessionId, room, false, null, null, null, false, null, null, []);
        }

        var staff = await IsStaffOrInstructorAsync(unitOfWork, tenant, sessionId, cancellationToken);
        Guid? me = null;
        await using (var mine = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", tenant.OrganizationId, tenant.MembershipId))
        {
            me = await mine.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        var holders = new Dictionary<Guid, (Guid BookingId, Guid PersonId, string Name, string Status, Guid? Avatar)>();
        await using (var read = unitOfWork.Command(
            """
            SELECT b.spot_id, b.id, p.id, p.display_name, b.status, p.avatar_media_id
            FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = $1 AND b.session_id = $2 AND b.spot_id IS NOT NULL AND b.status IN ('booked', 'attended', 'no_show')
            """,
            tenant.OrganizationId, sessionId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                holders[reader.GetGuid(0)] = (reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3), reader.GetString(4), await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetGuid(5));
            }
        }

        Guid? usual = null;
        var buddies = new HashSet<Guid>();
        if (me is { } person)
        {
            buddies = await BuddyService.BuddyIdsAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
            await using var preference = unitOfWork.Command("SELECT spot_id FROM scheduling.spot_preferences WHERE organization_id = $1 AND person_id = $2 AND room_id = $3", tenant.OrganizationId, person, room);
            usual = await preference.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        var now = clock.GetUtcNow();
        var spots = new List<SessionSpotView>();
        foreach (var spot in layout.Spots)
        {
            if (spot.Status == "maintenance")
            {
                spots.Add(new SessionSpotView(spot.Id, spot.Label, spot.Row, spot.Col, spot.Kind, "maintenance"));
                continue;
            }

            if (!holders.TryGetValue(spot.Id, out var holder))
            {
                spots.Add(new SessionSpotView(spot.Id, spot.Label, spot.Row, spot.Col, spot.Kind, "free"));
                continue;
            }

            var state = holder.PersonId == me ? "mine" : "taken";
            if (state == "taken" && buddies.Contains(holder.PersonId))
            {
                state = "buddy";
                if (!staff)
                {
                    spots.Add(new SessionSpotView(spot.Id, spot.Label, spot.Row, spot.Col, spot.Kind, state, null, new PersonRefView(holder.PersonId, holder.Name), AvatarMediaId: holder.Avatar));
                    continue;
                }
            }

            spots.Add(staff
                ? new SessionSpotView(spot.Id, spot.Label, spot.Row, spot.Col, spot.Kind, state, holder.BookingId, new PersonRefView(holder.PersonId, holder.Name), holder.Status,
                    await HealthStatus.OfPersonAsync(unitOfWork, tenant.OrganizationId, holder.PersonId, now, cancellationToken), holder.Avatar)
                : new SessionSpotView(spot.Id, spot.Label, spot.Row, spot.Col, spot.Kind, state, MineOnly(state, holder.BookingId)));
        }

        static Guid? MineOnly(string state, Guid bookingId) => state == "mine" ? bookingId : null;

        var mySpot = spots.FirstOrDefault(s => s.State == "mine")?.Id;
        return new SessionSpotsView(sessionId, room, true, layout.Rows, layout.Cols, layout.WindowSide, layout.MirrorFront, mySpot, usual, spots);
    }

    public async Task<BookingView> ChangeSpotAsync(TenantContext tenant, Guid bookingId, Guid spotId, CancellationToken cancellationToken)
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

        // The session row is the lock every spot decision of this class takes (booking, promotion, change).
        var session = await SessionAsync(unitOfWork, tenant.OrganizationId, sessionId, cancellationToken, forUpdate: true);
        if (status is not ("booked" or "attended" or "no_show") || (!staff && (status != "booked" || session.StartsAt <= clock.GetUtcNow())))
        {
            throw Conflict("booking.not_cancellable", "The spot of this booking can no longer be changed.");
        }

        await RequireFreeSpotAsync(unitOfWork, tenant.OrganizationId, sessionId, spotId, bookingId, cancellationToken);
        try
        {
            await using var update = unitOfWork.Command(
                "UPDATE scheduling.bookings SET spot_id = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId, bookingId, spotId);
            await update.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == "ux_bookings_session_spot")
        {
            throw Conflict("booking.spot_unavailable", "Someone already holds this spot.");
        }

        await AuditAsync(unitOfWork, tenant, "booking.spot_changed", bookingId, new { sessionId, spotId }, cancellationToken);
        var changed = (await BookingsAsync(unitOfWork, tenant.OrganizationId, "WHERE b.organization_id = $1 AND b.id = $2", cancellationToken, bookingId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return changed;
    }

    public async Task SetUsualSpotAsync(TenantContext tenant, Guid roomId, Guid? spotId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        if (spotId is { } spot)
        {
            await using (var check = unitOfWork.Command(
                "SELECT 1 FROM scheduling.room_spots WHERE organization_id = $1 AND room_id = $2 AND id = $3 AND status <> 'archived'",
                tenant.OrganizationId, roomId, spot))
            {
                if (await check.ExecuteScalarAsync(cancellationToken) is null)
                {
                    throw new DomainRuleViolationException(ViolationKind.Validation, "spot.not_found", "Choose a spot of this room.", "spotId");
                }
            }

            await using var upsert = unitOfWork.Command(
                """
                INSERT INTO scheduling.spot_preferences (organization_id, person_id, room_id, spot_id, updated_at) VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (organization_id, person_id, room_id) DO UPDATE SET spot_id = EXCLUDED.spot_id, updated_at = now()
                """,
                tenant.OrganizationId, person, roomId, spot);
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            await using var clear = unitOfWork.Command("DELETE FROM scheduling.spot_preferences WHERE organization_id = $1 AND person_id = $2 AND room_id = $3", tenant.OrganizationId, person, roomId);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// The spot a new place takes (docs/33 X-3): the requested one, else the person's usual spot when free, else
    /// the first free spot by row and column. Null when the session's room offers no spot selection. Callers hold
    /// the session row lock (the place was just taken with an UPDATE of it), so two places of one class can't pick
    /// the same spot; the unique index is the backstop. Throws session.full when no spot is free.
    /// </summary>
    internal static async Task<Guid?> AssignSpotAsync(UnitOfWork unitOfWork, Guid organizationId, Guid sessionId, Guid personId, Guid? requested, CancellationToken cancellationToken)
    {
        Guid? room = null;
        var selection = false;
        await using (var read = unitOfWork.Command(
            """
            SELECT r.id, r.spot_selection FROM scheduling.sessions s
            JOIN scheduling.rooms r ON r.organization_id = s.organization_id AND r.id = s.room_id
            WHERE s.organization_id = $1 AND s.id = $2
            """,
            organizationId, sessionId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                room = reader.GetGuid(0);
                selection = reader.GetBoolean(1);
            }
        }

        if (!selection)
        {
            if (requested is not null)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "booking.spot_not_offered", "This class has no spots to choose.", "spotId");
            }

            return null;
        }

        if (requested is { } chosen)
        {
            await RequireFreeSpotAsync(unitOfWork, organizationId, sessionId, chosen, null, cancellationToken);
            return chosen;
        }

        await using var pick = unitOfWork.Command(
            """
            SELECT rs.id FROM scheduling.room_spots rs
            LEFT JOIN scheduling.spot_preferences sp ON sp.organization_id = rs.organization_id AND sp.person_id = $3 AND sp.room_id = rs.room_id AND sp.spot_id = rs.id
            WHERE rs.organization_id = $1 AND rs.room_id = $4 AND rs.status = 'active'
              AND NOT EXISTS (SELECT 1 FROM scheduling.bookings b WHERE b.organization_id = rs.organization_id AND b.session_id = $2 AND b.spot_id = rs.id
                              AND b.status IN ('booked', 'attended', 'no_show'))
            ORDER BY sp.spot_id IS NULL, rs.row_index, rs.col_index
            LIMIT 1
            """,
            organizationId, sessionId, personId, room!.Value);
        return await pick.ExecuteScalarAsync(cancellationToken) as Guid?
            ?? throw Conflict("session.full", "This class is full.");
    }

    private static async Task RequireFreeSpotAsync(UnitOfWork unitOfWork, Guid organizationId, Guid sessionId, Guid spotId, Guid? exceptBooking, CancellationToken cancellationToken)
    {
        await using var check = unitOfWork.Command(
            """
            SELECT rs.status = 'active' AND r.spot_selection
               AND NOT EXISTS (SELECT 1 FROM scheduling.bookings b WHERE b.organization_id = rs.organization_id AND b.session_id = s.id AND b.spot_id = rs.id
                               AND b.status IN ('booked', 'attended', 'no_show') AND ($4::uuid IS NULL OR b.id <> $4))
            FROM scheduling.sessions s
            JOIN scheduling.rooms r ON r.organization_id = s.organization_id AND r.id = s.room_id
            JOIN scheduling.room_spots rs ON rs.organization_id = r.organization_id AND rs.room_id = r.id AND rs.id = $3
            WHERE s.organization_id = $1 AND s.id = $2
            """,
            organizationId, sessionId, spotId, exceptBooking);
        if (await check.ExecuteScalarAsync(cancellationToken) is not true)
        {
            throw Conflict("booking.spot_unavailable", "This spot can't be booked for this class.");
        }
    }

    /// <summary>
    /// After a layout save: with selection on, every future class of the room must fit its active spots, and its
    /// booked places without a spot get one (usual spot first); with selection off, future places drop their spot.
    /// </summary>
    private static async Task PlaceFutureBookingsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid roomId, bool selection, int activeSpots, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!selection)
        {
            await using var clear = unitOfWork.Command(
                """
                UPDATE scheduling.bookings b SET spot_id = NULL, updated_at = now(), version = version + 1
                FROM scheduling.sessions s
                WHERE b.organization_id = $1 AND s.organization_id = b.organization_id AND s.id = b.session_id
                  AND s.room_id = $2 AND s.starts_at > $3 AND b.spot_id IS NOT NULL AND b.status = 'booked'
                """,
                organizationId, roomId, now);
            await clear.ExecuteNonQueryAsync(cancellationToken);
            return;
        }

        var unplaced = new List<(Guid SessionId, Guid BookingId, Guid PersonId)>();
        await using (var read = unitOfWork.Command(
            """
            SELECT s.id, s.booked_count, b.id, b.person_id
            FROM scheduling.sessions s
            LEFT JOIN scheduling.bookings b ON b.organization_id = s.organization_id AND b.session_id = s.id AND b.status = 'booked' AND b.spot_id IS NULL
            WHERE s.organization_id = $1 AND s.room_id = $2 AND s.starts_at > $3 AND s.status = 'scheduled'
            ORDER BY s.starts_at, b.created_at
            FOR UPDATE OF s
            """,
            organizationId, roomId, now))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                if (reader.GetInt32(1) > activeSpots)
                {
                    throw Conflict("room.spots_below_booked", "A future class in this room has more places booked than the room has spots.");
                }

                if (!await reader.IsDBNullAsync(2, cancellationToken))
                {
                    unplaced.Add((reader.GetGuid(0), reader.GetGuid(2), reader.GetGuid(3)));
                }
            }
        }

        foreach (var (sessionId, bookingId, personId) in unplaced)
        {
            var spot = await AssignSpotAsync(unitOfWork, organizationId, sessionId, personId, null, cancellationToken);
            await using var place = unitOfWork.Command(
                "UPDATE scheduling.bookings SET spot_id = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                organizationId, bookingId, spot);
            await place.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task<bool> IsStaffOrInstructorAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid sessionId, CancellationToken cancellationToken)
    {
        try
        {
            await StaffOrInstructorAsync(unitOfWork, tenant, sessionId, Permissions.BookingsManage, cancellationToken);
            return true;
        }
        catch (DomainRuleViolationException e) when (e.Kind == ViolationKind.Forbidden)
        {
            return false;
        }
    }

    private static async Task<RoomLayoutView> ReadLayoutAsync(UnitOfWork unitOfWork, Guid organizationId, Guid roomId, CancellationToken cancellationToken, bool includeArchived = false)
    {
        bool selection;
        int? rows, cols;
        string? window;
        bool mirror;
        long version;
        await using (var room = unitOfWork.Command(
            "SELECT spot_selection, layout_rows, layout_cols, window_side, mirror_front, version FROM scheduling.rooms WHERE organization_id = $1 AND id = $2",
            organizationId, roomId))
        await using (var reader = await room.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "room.not_found", "Room not found.");
            }

            selection = reader.GetBoolean(0);
            rows = await reader.IsDBNullAsync(1, cancellationToken) ? null : reader.GetInt16(1);
            cols = await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetInt16(2);
            window = await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetString(3);
            mirror = reader.GetBoolean(4);
            version = reader.GetInt64(5);
        }

        var spots = new List<SpotView>();
        await using (var read = unitOfWork.Command(
            $"""
            SELECT id, label, row_index, col_index, kind, status FROM scheduling.room_spots
            WHERE organization_id = $1 AND room_id = $2 {(includeArchived ? "" : "AND status <> 'archived'")}
            ORDER BY row_index, col_index
            """,
            organizationId, roomId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                spots.Add(new SpotView(reader.GetGuid(0), reader.GetString(1), reader.GetInt16(2), reader.GetInt16(3), reader.GetString(4), reader.GetString(5)));
            }
        }

        return new RoomLayoutView(roomId, selection, rows, cols, window, mirror, spots, version);
    }

    private static List<SpotInput> ValidateLayout(RoomLayoutInput input)
    {
        static DomainRuleViolationException Invalid(string code, string message) => new(ViolationKind.Validation, code, message, "spots");

        if (input.WindowSide is not (null or "start" or "end" or "back"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "layout.invalid", "The window is at the start, the end or the back.", "windowSide");
        }

        if ((input.Spots.Count > 0 || input.SpotSelection) && (input.Rows is not (>= 1 and <= 12) || input.Cols is not (>= 1 and <= 12)))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "layout.invalid", "A layout has 1 to 12 rows and 1 to 12 columns.", "rows");
        }

        var spots = new List<SpotInput>();
        foreach (var spot in input.Spots)
        {
            var label = spot.Label?.Trim();
            if (label is not { Length: >= 1 and <= 8 })
            {
                throw Invalid("layout.invalid", "Every spot has a label of 1 to 8 characters.");
            }

            if (spot.Row is not { } row || spot.Col is not { } col || row < 0 || col < 0 || row >= input.Rows || col >= input.Cols)
            {
                throw Invalid("layout.invalid", $"Spot {label} is outside the grid.");
            }

            var kind = spot.Kind ?? "place";
            if (!SpotKinds.Contains(kind))
            {
                throw Invalid("layout.invalid", $"Spot {label} has an unknown kind.");
            }

            var status = spot.Status ?? "active";
            if (status is not ("active" or "maintenance"))
            {
                throw Invalid("layout.invalid", $"Spot {label} is active or under maintenance.");
            }

            spots.Add(spot with { Label = label, Kind = kind, Status = status });
        }

        if (spots.GroupBy(s => (s.Row, s.Col)).Any(g => g.Count() > 1))
        {
            throw Invalid("layout.duplicate_cell", "Two spots are in the same place.");
        }

        if (spots.GroupBy(s => s.Label!.ToLowerInvariant()).Any(g => g.Count() > 1))
        {
            throw Invalid("layout.duplicate_label", "Two spots have the same label.");
        }

        if (spots.Where(s => s.Id is not null).GroupBy(s => s.Id).Any(g => g.Count() > 1))
        {
            throw Invalid("layout.invalid", "A spot appears twice.");
        }

        if (input.SpotSelection && !spots.Any(s => s.Status == "active"))
        {
            throw Invalid("layout.invalid", "Spot selection needs at least one active spot.");
        }

        return spots;
    }
}
