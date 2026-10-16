using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Billing;
using Tempo.Platform.Modules.Scheduling.Domain;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record RoomView(Guid Id, string Name, int DefaultCapacity, string Status, long Version);

public sealed record ClassTypeView(Guid Id, string Name, string Category, string Color, int DefaultMinutes, string? Description, string Status, long Version);

public sealed record TemplateView(
    Guid Id,
    Guid ClassTypeId,
    int Weekday,
    TimeOnly LocalStart,
    int Minutes,
    Guid? InstructorMembershipId,
    Guid? RoomId,
    int Capacity,
    DateOnly ValidFrom,
    DateOnly? ValidUntil,
    long Version,
    // What the console shows on a weekly class without a second request (A1, #136). The daily job reads
    // templates without them, so they stay optional here and required on the API.
    ClassTypeView? ClassType = null,
    InstructorView? Instructor = null,
    RoomView? Room = null);

public sealed record InstructorView(Guid MembershipId, string DisplayName);

public sealed record MyBookingStateView(Guid BookingId, string Status, int? WaitlistPosition, DateTimeOffset? FreeCancelUntil);

public sealed record SessionView(
    Guid Id,
    Guid? TemplateId,
    DateOnly LocalDate,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    ClassTypeView ClassType,
    InstructorView? Instructor,
    RoomView? Room,
    int Capacity,
    int BookedCount,
    int WaitlistCount,
    string Status,
    MyBookingStateView? MyBooking,
    long Version,
    PassSummaryView? PassPreview = null,
    DateOnly? FrozenUntil = null);

public sealed record TemplateChange(TemplateView Template, IReadOnlyList<SessionView> UntouchedSessions);

public sealed record NewRoom(string? Name, int? DefaultCapacity);

public sealed record RoomChanges(string? Name, int? DefaultCapacity, string? Status);

public sealed record NewClassType(string? Name, string? Category, string? Color, int? DefaultMinutes, string? Description);

public sealed record ClassTypeChanges(string? Name, string? Category, string? Color, int? DefaultMinutes, Change<string?> Description, string? Status);

public sealed record NewTemplate(
    Guid ClassTypeId,
    int? Weekday,
    TimeOnly? LocalStart,
    int? Minutes,
    Guid? InstructorMembershipId,
    Guid? RoomId,
    int? Capacity,
    DateOnly? ValidFrom,
    DateOnly? ValidUntil);

public sealed record TemplateChanges(
    int? Weekday,
    TimeOnly? LocalStart,
    int? Minutes,
    Change<Guid?> InstructorMembershipId,
    Change<Guid?> RoomId,
    int? Capacity,
    Change<DateOnly?> ValidUntil);

public sealed record NewSession(Guid ClassTypeId, DateOnly? LocalDate, TimeOnly? LocalStart, int? Minutes, Guid? InstructorMembershipId, Guid? RoomId, int? Capacity);

public sealed record SessionQuery(DateOnly From, DateOnly To, Guid? ClassTypeId, Guid? InstructorMembershipId);

/// <summary>A field in a PATCH body: <c>default</c> when absent, set (null included) when sent.</summary>
public readonly record struct Change<T>(bool IsSet, T Value);

/// <summary>
/// The studio's timetable (docs/29 section 4): rooms, class types, weekly templates and their
/// sessions on a rolling eight-week horizon. Route permissions are checked by the API.
/// </summary>
public interface ITimetableService
{
    Task<IReadOnlyList<RoomView>> ListRoomsAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<RoomView> CreateRoomAsync(TenantContext tenant, NewRoom room, CancellationToken cancellationToken);

    Task<RoomView> UpdateRoomAsync(TenantContext tenant, Guid roomId, RoomChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<IReadOnlyList<ClassTypeView>> ListClassTypesAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<ClassTypeView> CreateClassTypeAsync(TenantContext tenant, NewClassType classType, CancellationToken cancellationToken);

    Task<ClassTypeView> UpdateClassTypeAsync(TenantContext tenant, Guid classTypeId, ClassTypeChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<IReadOnlyList<TemplateView>> ListTemplatesAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<TemplateChange> CreateTemplateAsync(TenantContext tenant, NewTemplate weeklyClass, CancellationToken cancellationToken);

    Task<TemplateChange> UpdateTemplateAsync(TenantContext tenant, Guid templateId, TemplateChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<IReadOnlyList<SessionView>> ListSessionsAsync(TenantContext tenant, SessionQuery query, CancellationToken cancellationToken);

    Task<SessionView> GetSessionAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken);

    Task<SessionView> CreateSessionAsync(TenantContext tenant, NewSession session, CancellationToken cancellationToken);
}

public sealed class TimetableService(IDataSourceProvider dataSources, TimeProvider clock) : ITimetableService
{
    /// <summary>How far ahead templates materialize (docs/29 section 4.1).</summary>
    public const int HorizonDays = 56;

    /// <summary>The widest range one `GET /sessions` returns (docs/29 section 4.3).</summary>
    public const int MaxRangeDays = 62;

    private static readonly string[] Colors = ["sage", "rose", "taupe", "amber", "mauve", "blue"];

    private const string RoomColumns = "id, name, default_capacity, status, version";
    private const string ClassTypeColumns = "id, name, category, color, default_minutes, description, status, version";
    // $1 organization. A template with its class type, instructor name and room, as the console lists it.
    private const string TemplateSelect =
        """
        SELECT t.id, t.class_type_id, t.weekday, t.local_start, t.minutes, t.instructor_membership_id, t.room_id, t.capacity, t.valid_from, t.valid_until, t.version,
               ct.id, ct.name, ct.category, ct.color, ct.default_minutes, ct.description, ct.status, ct.version,
               (SELECT p.display_name FROM people.people p WHERE p.organization_id = t.organization_id AND p.membership_id = t.instructor_membership_id),
               r.id, r.name, r.default_capacity, r.status, r.version
        FROM scheduling.templates t
        JOIN scheduling.class_types ct ON ct.organization_id = t.organization_id AND ct.id = t.class_type_id
        LEFT JOIN scheduling.rooms r ON r.organization_id = t.organization_id AND r.id = t.room_id
        """;

    // $1 organization, $2 caller's membership. The caller's own place counts only people still waiting ahead of them.
    private const string SessionSelect =
        """
        SELECT s.id, s.template_id, s.local_date, s.starts_at, s.ends_at,
               ct.id, ct.name, ct.category, ct.color, ct.default_minutes, ct.description, ct.status, ct.version,
               s.instructor_membership_id,
               (SELECT p.display_name FROM people.people p WHERE p.organization_id = s.organization_id AND p.membership_id = s.instructor_membership_id),
               r.id, r.name, r.default_capacity, r.status, r.version,
               s.capacity, s.booked_count,
               (SELECT count(*)::int FROM scheduling.bookings w WHERE w.organization_id = s.organization_id AND w.session_id = s.id AND w.status = 'waitlisted'),
               s.status, s.version,
               mine.id, mine.status,
               CASE WHEN mine.status = 'waitlisted' THEN
                   (SELECT count(*)::int FROM scheduling.bookings w WHERE w.organization_id = s.organization_id AND w.session_id = s.id
                      AND w.status = 'waitlisted' AND w.waitlist_position <= mine.waitlist_position)
               END
        FROM scheduling.sessions s
        JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
        LEFT JOIN scheduling.rooms r ON r.organization_id = s.organization_id AND r.id = s.room_id
        LEFT JOIN LATERAL (
            SELECT b.id, b.status, b.waitlist_position
            FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = s.organization_id AND b.session_id = s.id AND p.membership_id = $2
              AND b.status IN ('booked', 'waitlisted', 'attended', 'no_show')
            LIMIT 1
        ) mine ON true
        """;

    public async Task<IReadOnlyList<RoomView>> ListRoomsAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command($"SELECT {RoomColumns} FROM scheduling.rooms WHERE organization_id = $1 ORDER BY status, name", tenant.OrganizationId);
        return await ReadRoomsAsync(command, cancellationToken);
    }

    public async Task<RoomView> CreateRoomAsync(TenantContext tenant, NewRoom room, CancellationToken cancellationToken)
    {
        var name = Name(room.Name, "name");
        var capacity = Capacity(room.DefaultCapacity ?? throw Required("defaultCapacity"), "defaultCapacity");
        var id = Guid.CreateVersion7();

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await BillingService.CheckLimitAsync(unitOfWork, tenant.OrganizationId, "rooms.max", "SELECT count(*) FROM scheduling.rooms WHERE organization_id = $1 AND status = 'active'", cancellationToken);
        await using var command = unitOfWork.Command(
            $"INSERT INTO scheduling.rooms (organization_id, id, name, default_capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now()) RETURNING {RoomColumns}",
            tenant.OrganizationId, id, name, capacity);
        var created = (await ReadRoomsAsync(command, cancellationToken)).Single();
        await AuditAsync(unitOfWork, tenant, "room.created", "room", id, new { defaultCapacity = capacity }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<RoomView> UpdateRoomAsync(TenantContext tenant, Guid roomId, RoomChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        var name = changes.Name is null ? null : Name(changes.Name, "name");
        var capacity = changes.DefaultCapacity is { } c ? Capacity(c, "defaultCapacity") : (int?)null;
        var status = changes.Status is null ? null : ActiveOrArchived(changes.Status);

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        if (status == "active")
        {
            await BillingService.CheckLimitAsync(unitOfWork, tenant.OrganizationId, "rooms.max", "SELECT count(*) FROM scheduling.rooms WHERE organization_id = $1 AND status = 'active' AND id <> $2", cancellationToken, roomId);
        }

        await using var command = unitOfWork.Command(
            $"""
            UPDATE scheduling.rooms
            SET name = coalesce($3, name), default_capacity = coalesce($4, default_capacity), status = coalesce($5, status),
                updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2 AND ($6::bigint IS NULL OR version = $6)
            RETURNING {RoomColumns}
            """,
            tenant.OrganizationId, roomId, name, capacity, status, expectedVersion);
        var updated = (await ReadRoomsAsync(command, cancellationToken)).SingleOrDefault()
            ?? throw await MissingOrStaleAsync(unitOfWork, "scheduling.rooms", tenant.OrganizationId, roomId, "room.not_found", "Room not found.", cancellationToken);
        await AuditAsync(unitOfWork, tenant, "room.updated", "room", roomId, new { fields = Fields(("name", name), ("defaultCapacity", capacity), ("status", status)) }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<IReadOnlyList<ClassTypeView>> ListClassTypesAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command($"SELECT {ClassTypeColumns} FROM scheduling.class_types WHERE organization_id = $1 ORDER BY status, name", tenant.OrganizationId);
        return await ReadClassTypesAsync(command, cancellationToken);
    }

    public async Task<ClassTypeView> CreateClassTypeAsync(TenantContext tenant, NewClassType classType, CancellationToken cancellationToken)
    {
        var name = Name(classType.Name, "name");
        var category = Category(classType.Category ?? throw Required("category"), "category");
        var color = Color(classType.Color ?? throw Required("color"));
        var minutes = Minutes(classType.DefaultMinutes ?? throw Required("defaultMinutes"), "defaultMinutes");
        var description = Description(classType.Description);
        var id = Guid.CreateVersion7();

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await BillingService.CheckLimitAsync(unitOfWork, tenant.OrganizationId, "class_types.max", "SELECT count(*) FROM scheduling.class_types WHERE organization_id = $1 AND status = 'active'", cancellationToken);
        await using var command = unitOfWork.Command(
            $"""
            INSERT INTO scheduling.class_types (organization_id, id, name, category, color, default_minutes, description, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', now(), now())
            RETURNING {ClassTypeColumns}
            """,
            tenant.OrganizationId, id, name, category, color, minutes, description);
        var created = (await ReadClassTypesAsync(command, cancellationToken)).Single();
        await AuditAsync(unitOfWork, tenant, "class_type.created", "class_type", id, new { category }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<ClassTypeView> UpdateClassTypeAsync(TenantContext tenant, Guid classTypeId, ClassTypeChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        var name = changes.Name is null ? null : Name(changes.Name, "name");
        var category = changes.Category is null ? null : Category(changes.Category, "category");
        var color = changes.Color is null ? null : Color(changes.Color);
        var minutes = changes.DefaultMinutes is { } m ? Minutes(m, "defaultMinutes") : (int?)null;
        var description = changes.Description.IsSet ? Description(changes.Description.Value) : null;
        var status = changes.Status is null ? null : ActiveOrArchived(changes.Status);

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        if (status == "active")
        {
            await BillingService.CheckLimitAsync(unitOfWork, tenant.OrganizationId, "class_types.max", "SELECT count(*) FROM scheduling.class_types WHERE organization_id = $1 AND status = 'active' AND id <> $2", cancellationToken, classTypeId);
        }

        await using var command = unitOfWork.Command(
            $"""
            UPDATE scheduling.class_types
            SET name = coalesce($3, name), category = coalesce($4, category), color = coalesce($5, color),
                default_minutes = coalesce($6, default_minutes),
                description = CASE WHEN $7 THEN $8 ELSE description END,
                status = coalesce($9, status), updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2 AND ($10::bigint IS NULL OR version = $10)
            RETURNING {ClassTypeColumns}
            """,
            tenant.OrganizationId, classTypeId, name, category, color, minutes, changes.Description.IsSet, description, status, expectedVersion);
        var updated = (await ReadClassTypesAsync(command, cancellationToken)).SingleOrDefault()
            ?? throw await MissingOrStaleAsync(unitOfWork, "scheduling.class_types", tenant.OrganizationId, classTypeId, "class_type.not_found", "Class type not found.", cancellationToken);
        await AuditAsync(
            unitOfWork,
            tenant,
            "class_type.updated",
            "class_type",
            classTypeId,
            new { fields = Fields(("name", name), ("category", category), ("color", color), ("defaultMinutes", minutes), ("description", changes.Description.IsSet ? "" : null), ("status", status)) },
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<IReadOnlyList<TemplateView>> ListTemplatesAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command(
            $"{TemplateSelect} WHERE t.organization_id = $1 ORDER BY t.weekday, t.local_start",
            tenant.OrganizationId);
        return await ReadTemplatesAsync(command, cancellationToken);
    }

    public async Task<TemplateChange> CreateTemplateAsync(TenantContext tenant, NewTemplate weeklyClass, CancellationToken cancellationToken)
    {
        var weekday = Weekday(weeklyClass.Weekday ?? throw Required("weekday"));
        var start = weeklyClass.LocalStart ?? throw Required("localStart");
        var capacity = Capacity(weeklyClass.Capacity ?? throw Required("capacity"), "capacity");
        var id = Guid.CreateVersion7();

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var zone = await StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var today = Today(zone);
        var validFrom = weeklyClass.ValidFrom ?? today;
        if (weeklyClass.ValidUntil is { } until && until < validFrom)
        {
            throw Invalid("validUntil", "End the weekly class on or after its first day.");
        }

        var classType = await ClassTypeAsync(unitOfWork, tenant.OrganizationId, weeklyClass.ClassTypeId, cancellationToken);
        var minutes = weeklyClass.Minutes is { } m ? Minutes(m, "minutes") : classType.DefaultMinutes;
        await CheckInstructorAsync(unitOfWork, tenant.OrganizationId, weeklyClass.InstructorMembershipId, cancellationToken);
        await CheckRoomAsync(unitOfWork, tenant.OrganizationId, weeklyClass.RoomId, cancellationToken);

        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO scheduling.templates (organization_id, id, class_type_id, weekday, local_start, minutes, instructor_membership_id, room_id, capacity, valid_from, valid_until, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
            """,
            tenant.OrganizationId, id, classType.Id, (short)weekday, start, minutes, weeklyClass.InstructorMembershipId, weeklyClass.RoomId, capacity, validFrom, weeklyClass.ValidUntil))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        var created = (await TemplateAsync(unitOfWork, tenant.OrganizationId, id, cancellationToken))!;
        var count = await MaterializeAsync(unitOfWork, tenant.OrganizationId, created, zone, today, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "template.created", "template", id, new { weekday, sessions = count }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new TemplateChange(created, []);
    }

    public async Task<TemplateChange> UpdateTemplateAsync(TenantContext tenant, Guid templateId, TemplateChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = await TemplateAsync(unitOfWork, tenant.OrganizationId, templateId, cancellationToken, forUpdate: true)
            ?? throw NotFound("template.not_found", "Weekly class not found.");
        if (expectedVersion is { } expected && expected != current.Version)
        {
            throw Concurrency();
        }

        var zone = await StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var next = current with
        {
            Weekday = changes.Weekday is { } w ? Weekday(w) : current.Weekday,
            LocalStart = changes.LocalStart ?? current.LocalStart,
            Minutes = changes.Minutes is { } m ? Minutes(m, "minutes") : current.Minutes,
            InstructorMembershipId = changes.InstructorMembershipId.IsSet ? changes.InstructorMembershipId.Value : current.InstructorMembershipId,
            RoomId = changes.RoomId.IsSet ? changes.RoomId.Value : current.RoomId,
            Capacity = changes.Capacity is { } c ? Capacity(c, "capacity") : current.Capacity,
            ValidUntil = changes.ValidUntil.IsSet ? changes.ValidUntil.Value : current.ValidUntil
        };
        if (next.ValidUntil is { } until && until < next.ValidFrom)
        {
            throw Invalid("validUntil", "End the weekly class on or after its first day.");
        }

        if (changes.InstructorMembershipId.IsSet)
        {
            await CheckInstructorAsync(unitOfWork, tenant.OrganizationId, next.InstructorMembershipId, cancellationToken);
        }

        if (changes.RoomId.IsSet)
        {
            await CheckRoomAsync(unitOfWork, tenant.OrganizationId, next.RoomId, cancellationToken);
        }

        await using (var update = unitOfWork.Command(
            """
            UPDATE scheduling.templates
            SET weekday = $3, local_start = $4, minutes = $5, instructor_membership_id = $6, room_id = $7, capacity = $8,
                valid_until = $9, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            """,
            tenant.OrganizationId, templateId, (short)next.Weekday, next.LocalStart, next.Minutes, next.InstructorMembershipId, next.RoomId, next.Capacity, next.ValidUntil))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        // Future sessions that nobody ever booked are rebuilt from the new rule; the rest keep their values.
        await using (var drop = unitOfWork.Command(
            """
            DELETE FROM scheduling.sessions s
            WHERE s.organization_id = $1 AND s.template_id = $2 AND s.starts_at > now()
              AND NOT EXISTS (SELECT 1 FROM scheduling.bookings b WHERE b.organization_id = s.organization_id AND b.session_id = s.id)
            """,
            tenant.OrganizationId, templateId))
        {
            await drop.ExecuteNonQueryAsync(cancellationToken);
        }

        var updated = (await TemplateAsync(unitOfWork, tenant.OrganizationId, templateId, cancellationToken))!;
        var today = Today(zone);
        await MaterializeAsync(unitOfWork, tenant.OrganizationId, updated, zone, today, cancellationToken);
        var untouched = await SessionsAsync(
            unitOfWork,
            tenant,
            "WHERE s.organization_id = $1 AND s.template_id = $3 AND s.starts_at > now() AND s.status = 'scheduled' AND EXISTS (SELECT 1 FROM scheduling.bookings b WHERE b.organization_id = s.organization_id AND b.session_id = s.id) ORDER BY s.starts_at",
            cancellationToken,
            templateId);
        await AuditAsync(unitOfWork, tenant, "template.updated", "template", templateId, new { untouchedSessions = untouched.Count }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new TemplateChange(updated, untouched);
    }

    public async Task<IReadOnlyList<SessionView>> ListSessionsAsync(TenantContext tenant, SessionQuery query, CancellationToken cancellationToken)
    {
        if (query.To < query.From || query.To.DayNumber - query.From.DayNumber > MaxRangeDays)
        {
            throw Invalid("to", $"Ask for 1 to {MaxRangeDays + 1} days at a time.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var to = query.To;
        if (!tenant.Has(Permissions.BookingsManage))
        {
            // Members see the timetable up to the booking horizon (docs/29 section 4.3).
            var zone = await StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
            var horizon = Today(zone).AddDays(await HorizonDaysAsync(unitOfWork, tenant.OrganizationId, cancellationToken));
            to = to > horizon ? horizon : to;
        }

        return await SessionsAsync(
            unitOfWork,
            tenant,
            "WHERE s.organization_id = $1 AND s.local_date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR s.class_type_id = $5) AND ($6::uuid IS NULL OR s.instructor_membership_id = $6) ORDER BY s.starts_at, s.id",
            cancellationToken,
            query.From, to, query.ClassTypeId, query.InstructorMembershipId);
    }

    public async Task<SessionView> GetSessionAsync(TenantContext tenant, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return (await SessionsAsync(unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = $3", cancellationToken, sessionId)).SingleOrDefault()
            ?? throw NotFound("session.not_found", "Class not found.");
    }

    public async Task<SessionView> CreateSessionAsync(TenantContext tenant, NewSession session, CancellationToken cancellationToken)
    {
        var date = session.LocalDate ?? throw Required("localDate");
        var start = session.LocalStart ?? throw Required("localStart");
        var capacity = Capacity(session.Capacity ?? throw Required("capacity"), "capacity");
        var id = Guid.CreateVersion7();

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var zone = await StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var classType = await ClassTypeAsync(unitOfWork, tenant.OrganizationId, session.ClassTypeId, cancellationToken);
        var minutes = session.Minutes is { } m ? Minutes(m, "minutes") : classType.DefaultMinutes;
        await CheckInstructorAsync(unitOfWork, tenant.OrganizationId, session.InstructorMembershipId, cancellationToken);
        await CheckRoomAsync(unitOfWork, tenant.OrganizationId, session.RoomId, cancellationToken);
        var startsAt = StudioTime.ToInstant(date, start, zone);
        if (startsAt <= clock.GetUtcNow())
        {
            throw Invalid("localDate", "Add classes that have not started yet.");
        }

        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO scheduling.sessions (organization_id, id, template_id, local_date, class_type_id, starts_at, ends_at, instructor_membership_id, room_id, capacity, status, created_at, updated_at)
            VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, 'scheduled', now(), now())
            """,
            tenant.OrganizationId, id, date, classType.Id, startsAt, startsAt.AddMinutes(minutes), session.InstructorMembershipId, session.RoomId, capacity))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "session.created", "session", id, new { classTypeId = classType.Id }, cancellationToken);
        var created = (await SessionsAsync(unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = $3", cancellationToken, id)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    /// <summary>
    /// Creates the template's missing sessions from <paramref name="today"/> to the horizon. The occurrence key
    /// (template, local date) is unique, so running it twice adds nothing (docs/29 section 4.1). Rows are
    /// created only while the template still has the version that was read, so a job working from an older
    /// snapshot never adds sessions for a rule staff have since changed (#108).
    /// </summary>
    internal static async Task<int> MaterializeAsync(UnitOfWork unitOfWork, Guid organizationId, TemplateView template, TimeZoneInfo zone, DateOnly today, CancellationToken cancellationToken)
    {
        var until = today.AddDays(HorizonDays);
        var created = 0;
        foreach (var date in StudioTime.Occurrences(template.Weekday, template.ValidFrom, template.ValidUntil, today, until))
        {
            var startsAt = StudioTime.ToInstant(date, template.LocalStart, zone);
            await using var insert = unitOfWork.Command(
                """
                INSERT INTO scheduling.sessions (organization_id, id, template_id, local_date, class_type_id, starts_at, ends_at, instructor_membership_id, room_id, capacity, status, created_at, updated_at)
                SELECT t.organization_id, $3, t.id, $4, t.class_type_id, $5, $6, t.instructor_membership_id, t.room_id, t.capacity, 'scheduled', now(), now()
                FROM scheduling.templates t
                WHERE t.organization_id = $1 AND t.id = $2 AND t.version = $7
                ON CONFLICT (organization_id, template_id, local_date) WHERE template_id IS NOT NULL DO NOTHING
                """,
                organizationId, template.Id, Guid.CreateVersion7(), date, startsAt, startsAt.AddMinutes(template.Minutes), template.Version);
            created += await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var mark = unitOfWork.Command(
            "UPDATE scheduling.templates SET materialized_until = $3 WHERE organization_id = $1 AND id = $2 AND version = $4",
            organizationId, template.Id, until, template.Version))
        {
            await mark.ExecuteNonQueryAsync(cancellationToken);
        }

        return created;
    }

    internal static async Task<TimeZoneInfo> StudioZoneAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT time_zone FROM organizations.organizations WHERE id = $1", organizationId);
        var id = await command.ExecuteScalarAsync(cancellationToken) as string ?? "Asia/Jerusalem";
        return TimeZoneInfo.FindSystemTimeZoneById(id);
    }

    private DateOnly Today(TimeZoneInfo zone) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);

    private static async Task<int> HorizonDaysAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT coalesce((SELECT booking_horizon_days FROM scheduling.booking_policies WHERE organization_id = $1), 14)",
            organizationId);
        return (int)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    internal static async Task<IReadOnlyList<SessionView>> SessionsAsync(UnitOfWork unitOfWork, TenantContext tenant, string where, CancellationToken cancellationToken, params object?[] more)
    {
        await using var policy = unitOfWork.Command(
            "SELECT coalesce((SELECT free_cancel_hours FROM scheduling.booking_policies WHERE organization_id = $1), 6)",
            tenant.OrganizationId);
        var freeCancelHours = (int)(await policy.ExecuteScalarAsync(cancellationToken))!;

        await using var command = unitOfWork.Command($"{SessionSelect} {where}", [tenant.OrganizationId, tenant.MembershipId, .. more]);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var sessions = new List<SessionView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var startsAt = await reader.GetFieldValueAsync<DateTimeOffset>(3, cancellationToken);
            var classType = new ClassTypeView(
                reader.GetGuid(5), reader.GetString(6), reader.GetString(7), reader.GetString(8), reader.GetInt32(9),
                await reader.IsDBNullAsync(10, cancellationToken) ? null : reader.GetString(10), reader.GetString(11), reader.GetInt64(12));
            InstructorView? instructor = null;
            if (!await reader.IsDBNullAsync(13, cancellationToken))
            {
                var name = await reader.IsDBNullAsync(14, cancellationToken) ? "" : reader.GetString(14);
                instructor = new InstructorView(reader.GetGuid(13), name);
            }

            RoomView? room = await reader.IsDBNullAsync(15, cancellationToken)
                ? null
                : new RoomView(reader.GetGuid(15), reader.GetString(16), reader.GetInt32(17), reader.GetString(18), reader.GetInt64(19));
            MyBookingStateView? mine = null;
            if (!await reader.IsDBNullAsync(25, cancellationToken))
            {
                var status = reader.GetString(26);
                mine = new MyBookingStateView(
                    reader.GetGuid(25),
                    status,
                    await reader.IsDBNullAsync(27, cancellationToken) ? null : reader.GetInt32(27),
                    status == "booked" ? startsAt.AddHours(-freeCancelHours) : null);
            }

            sessions.Add(new SessionView(
                reader.GetGuid(0),
                await reader.IsDBNullAsync(1, cancellationToken) ? null : reader.GetGuid(1),
                await reader.GetFieldValueAsync<DateOnly>(2, cancellationToken),
                startsAt,
                await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
                classType,
                instructor,
                room,
                reader.GetInt32(20),
                reader.GetInt32(21),
                reader.GetInt32(22),
                reader.GetString(23),
                mine,
                reader.GetInt64(24)));
        }

        await reader.CloseAsync();
        var bookable = sessions.Where(s => s.Status == "scheduled" && s.MyBooking is null).Select(s => (s.Id, s.LocalDate, s.ClassType.Category)).ToList();
        var previews = await BookingService.PreviewAsync(unitOfWork, tenant.OrganizationId, tenant.MembershipId, bookable, cancellationToken);
        return [.. sessions.Select(s => previews.TryGetValue(s.Id, out var p) ? s with { PassPreview = p.Preview, FrozenUntil = p.FrozenUntil } : s)];
    }

    private static async Task<TemplateView?> TemplateAsync(UnitOfWork unitOfWork, Guid organizationId, Guid templateId, CancellationToken cancellationToken, bool forUpdate = false)
    {
        await using var command = unitOfWork.Command(
            $"{TemplateSelect} WHERE t.organization_id = $1 AND t.id = $2{(forUpdate ? " FOR UPDATE OF t" : "")}",
            organizationId, templateId);
        return (await ReadTemplatesAsync(command, cancellationToken)).SingleOrDefault();
    }

    private static async Task<ClassTypeView> ClassTypeAsync(UnitOfWork unitOfWork, Guid organizationId, Guid classTypeId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command($"SELECT {ClassTypeColumns} FROM scheduling.class_types WHERE organization_id = $1 AND id = $2", organizationId, classTypeId);
        var classType = (await ReadClassTypesAsync(command, cancellationToken)).SingleOrDefault();
        return classType is { Status: "active" }
            ? classType
            : throw new DomainRuleViolationException(ViolationKind.Validation, "class_type.invalid", "Choose an active class type.", "classTypeId");
    }

    private static async Task CheckInstructorAsync(UnitOfWork unitOfWork, Guid organizationId, Guid? membershipId, CancellationToken cancellationToken)
    {
        if (membershipId is null)
        {
            return;
        }

        await using var command = unitOfWork.Command(
            "SELECT 1 FROM organizations.memberships WHERE organization_id = $1 AND id = $2 AND status = 'active' AND role <> 'client'",
            organizationId, membershipId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "instructor.invalid", "Choose an active staff member.", "instructorMembershipId");
        }
    }

    private static async Task CheckRoomAsync(UnitOfWork unitOfWork, Guid organizationId, Guid? roomId, CancellationToken cancellationToken)
    {
        if (roomId is null)
        {
            return;
        }

        await using var command = unitOfWork.Command("SELECT 1 FROM scheduling.rooms WHERE organization_id = $1 AND id = $2 AND status = 'active'", organizationId, roomId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "room.invalid", "Choose an active room.", "roomId");
        }
    }

    private static async Task<DomainRuleViolationException> MissingOrStaleAsync(UnitOfWork unitOfWork, string table, Guid organizationId, Guid id, string code, string message, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command($"SELECT 1 FROM {table} WHERE organization_id = $1 AND id = $2", organizationId, id);
        return await command.ExecuteScalarAsync(cancellationToken) is null ? NotFound(code, message) : Concurrency();
    }

    private static async Task<List<RoomView>> ReadRoomsAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rooms = new List<RoomView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rooms.Add(new RoomView(reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3), reader.GetInt64(4)));
        }

        return rooms;
    }

    private static async Task<List<ClassTypeView>> ReadClassTypesAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var types = new List<ClassTypeView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            types.Add(new ClassTypeView(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5), reader.GetString(6), reader.GetInt64(7)));
        }

        return types;
    }

    private static async Task<List<TemplateView>> ReadTemplatesAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var templates = new List<TemplateView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            templates.Add(new TemplateView(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetInt16(2),
                await reader.GetFieldValueAsync<TimeOnly>(3, cancellationToken),
                reader.GetInt32(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetGuid(5),
                await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetGuid(6),
                reader.GetInt32(7),
                await reader.GetFieldValueAsync<DateOnly>(8, cancellationToken),
                await reader.IsDBNullAsync(9, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(9, cancellationToken),
                reader.GetInt64(10),
                new ClassTypeView(
                    reader.GetGuid(11),
                    reader.GetString(12),
                    reader.GetString(13),
                    reader.GetString(14),
                    reader.GetInt32(15),
                    await reader.IsDBNullAsync(16, cancellationToken) ? null : reader.GetString(16),
                    reader.GetString(17),
                    reader.GetInt64(18)),
                await reader.IsDBNullAsync(5, cancellationToken) || await reader.IsDBNullAsync(19, cancellationToken)
                    ? null
                    : new InstructorView(reader.GetGuid(5), reader.GetString(19)),
                await reader.IsDBNullAsync(20, cancellationToken)
                    ? null
                    : new RoomView(reader.GetGuid(20), reader.GetString(21), reader.GetInt32(22), reader.GetString(23), reader.GetInt64(24))));
        }

        return templates;
    }

    private static string[] Fields(params (string Name, object? Value)[] fields) => [.. fields.Where(f => f.Value is not null).Select(f => f.Name)];

    private static string Name(string? value, string field)
    {
        var trimmed = value?.Trim() ?? throw Required(field);
        return trimmed.Length is >= 1 and <= 80 ? trimmed : throw Invalid(field, "Use 1 to 80 characters.");
    }

    private static string? Description(string? value)
    {
        var trimmed = value?.Trim();
        return trimmed switch
        {
            null or "" => null,
            { Length: > 1000 } => throw Invalid("description", "Use up to 1000 characters."),
            _ => trimmed
        };
    }

    private static string Category(string value, string field) =>
        System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-z][a-z0-9_]{1,29}$", System.Text.RegularExpressions.RegexOptions.None, TimeSpan.FromMilliseconds(100)) ? value : throw Invalid(field, "Use lowercase English letters, e.g. pilates.");

    private static string Color(string value) => Colors.Contains(value) ? value : throw Invalid("color", "Choose one of the class colors.");

    private static int Capacity(int value, string field) => value is >= 1 and <= 500 ? value : throw Invalid(field, "Use 1 to 500 places.");

    private static int Minutes(int value, string field) => value is >= 10 and <= 300 ? value : throw Invalid(field, "Use 10 to 300 minutes.");

    private static int Weekday(int value) => value is >= 0 and <= 6 ? value : throw Invalid("weekday", "Use 0 (Sunday) to 6 (Saturday).");

    private static string ActiveOrArchived(string value) => value is "active" or "archived" ? value : throw Invalid("status", "Use active or archived.");

    private static DomainRuleViolationException Required(string field) =>
        new(ViolationKind.Validation, $"{field}.required", "This field is required.", field);

    private static DomainRuleViolationException Invalid(string field, string message) =>
        new(ViolationKind.Validation, $"{field}.invalid", message, field);

    private static DomainRuleViolationException NotFound(string code, string message) => new(ViolationKind.NotFound, code, message);

    private static DomainRuleViolationException Concurrency() =>
        new(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, string targetType, Guid targetId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, targetType, targetId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
