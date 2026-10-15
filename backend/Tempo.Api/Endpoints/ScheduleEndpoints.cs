using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The studio's timetable (docs/29 sections 4 and 9): rooms, class types, weekly classes and sessions.
/// The service holds the rules; these handlers translate HTTP.
/// </summary>
public static class ScheduleEndpoints
{
    public static IEndpointRouteBuilder MapScheduleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/rooms", ListRoomsAsync).RequirePermission(Permissions.ScheduleView).WithName("listRooms").Produces<RoomListResponse>();
        tenant.MapPost("/rooms", CreateRoomAsync).RequirePermission(Permissions.ScheduleManage).WithName("createRoom").Produces<RoomResponse>(StatusCodes.Status201Created);
        tenant.MapPatch("/rooms/{roomId:guid}", UpdateRoomAsync).RequirePermission(Permissions.ScheduleManage).WithName("updateRoom").Produces<RoomResponse>();
        tenant.MapGet("/class-types", ListClassTypesAsync).RequirePermission(Permissions.ScheduleView).WithName("listClassTypes").Produces<ClassTypeListResponse>();
        tenant.MapPost("/class-types", CreateClassTypeAsync).RequirePermission(Permissions.ScheduleManage).WithName("createClassType").Produces<ClassTypeResponse>(StatusCodes.Status201Created);
        tenant.MapPatch("/class-types/{classTypeId:guid}", UpdateClassTypeAsync).RequirePermission(Permissions.ScheduleManage).WithName("updateClassType").Produces<ClassTypeResponse>();
        tenant.MapGet("/schedule-templates", ListTemplatesAsync).RequirePermission(Permissions.ScheduleManage).WithName("listScheduleTemplates").Produces<ScheduleTemplateListResponse>();
        tenant.MapPost("/schedule-templates", CreateTemplateAsync).RequirePermission(Permissions.ScheduleManage).WithName("createScheduleTemplate").Produces<ScheduleTemplateChangeResponse>(StatusCodes.Status201Created);
        tenant.MapPatch("/schedule-templates/{templateId:guid}", UpdateTemplateAsync).RequirePermission(Permissions.ScheduleManage).WithName("updateScheduleTemplate").Produces<ScheduleTemplateChangeResponse>();
        tenant.MapGet("/sessions", ListSessionsAsync).RequirePermission(Permissions.ScheduleView).WithName("listSessions").Produces<SessionListResponse>();
        tenant.MapPost("/sessions", CreateSessionAsync).RequirePermission(Permissions.ScheduleManage).WithName("createSession").Produces<SessionResponse>(StatusCodes.Status201Created);
        tenant.MapGet("/sessions/{sessionId:guid}", GetSessionAsync).RequirePermission(Permissions.ScheduleView).WithName("getSession").Produces<SessionResponse>();

        return endpoints;
    }

    private static async Task<IResult> ListRoomsAsync(HttpContext httpContext, ITimetableService timetable) =>
        Results.Ok(new RoomListResponse([.. (await timetable.ListRoomsAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> CreateRoomAsync(HttpContext httpContext, CreateRoomRequest request, ITimetableService timetable)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var room = await timetable.CreateRoomAsync(tenant, new NewRoom(request.Name, request.DefaultCapacity), httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/rooms/{room.Id}", ToResponse(room));
    }

    private static async Task<IResult> UpdateRoomAsync(
        HttpContext httpContext,
        Guid roomId,
        UpdateRoomRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        ITimetableService timetable)
    {
        var room = await timetable.UpdateRoomAsync(
            TenantRouteFilter.Current(httpContext),
            roomId,
            new RoomChanges(request.Name, request.DefaultCapacity, request.Status),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(room));
    }

    private static async Task<IResult> ListClassTypesAsync(HttpContext httpContext, ITimetableService timetable) =>
        Results.Ok(new ClassTypeListResponse([.. (await timetable.ListClassTypesAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> CreateClassTypeAsync(HttpContext httpContext, CreateClassTypeRequest request, ITimetableService timetable)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var created = await timetable.CreateClassTypeAsync(
            tenant,
            new NewClassType(request.Name, request.Category, request.Color, request.DefaultMinutes, request.Description),
            httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/class-types/{created.Id}", ToResponse(created));
    }

    private static async Task<IResult> UpdateClassTypeAsync(
        HttpContext httpContext,
        Guid classTypeId,
        [FromBody] JsonElement body,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        ITimetableService timetable)
    {
        RequireObject(body);
        var changes = new ClassTypeChanges(
            OptionalString(body, "name"),
            OptionalString(body, "category"),
            OptionalString(body, "color"),
            OptionalInt(body, "defaultMinutes"),
            Nullable<string?>(body, "description", e => StringOf(e, "description")),
            OptionalString(body, "status"));
        var updated = await timetable.UpdateClassTypeAsync(TenantRouteFilter.Current(httpContext), classTypeId, changes, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> ListTemplatesAsync(HttpContext httpContext, ITimetableService timetable) =>
        Results.Ok(new ScheduleTemplateListResponse([.. (await timetable.ListTemplatesAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> CreateTemplateAsync(HttpContext httpContext, CreateScheduleTemplateRequest request, ITimetableService timetable)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var change = await timetable.CreateTemplateAsync(
            tenant,
            new NewTemplate(
                request.ClassTypeId ?? throw Required("classTypeId"),
                request.Weekday,
                request.LocalStart is null ? null : ParseTime(request.LocalStart, "localStart"),
                request.Minutes,
                request.InstructorMembershipId,
                request.RoomId,
                request.Capacity,
                request.ValidFrom,
                request.ValidUntil),
            httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/schedule-templates/{change.Template.Id}", ToResponse(change));
    }

    private static async Task<IResult> UpdateTemplateAsync(
        HttpContext httpContext,
        Guid templateId,
        [FromBody] JsonElement body,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        ITimetableService timetable)
    {
        RequireObject(body);
        var start = OptionalString(body, "localStart");
        var changes = new TemplateChanges(
            OptionalInt(body, "weekday"),
            start is null ? null : ParseTime(start, "localStart"),
            OptionalInt(body, "minutes"),
            Nullable<Guid?>(body, "instructorMembershipId", e => GuidOf(e, "instructorMembershipId")),
            Nullable<Guid?>(body, "roomId", e => GuidOf(e, "roomId")),
            OptionalInt(body, "capacity"),
            Nullable<DateOnly?>(body, "validUntil", e => DateOf(e, "validUntil")));
        var change = await timetable.UpdateTemplateAsync(TenantRouteFilter.Current(httpContext), templateId, changes, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted);
        return Results.Ok(ToResponse(change));
    }

    private static async Task<IResult> ListSessionsAsync(
        HttpContext httpContext,
        string? from,
        string? to,
        Guid? classTypeId,
        Guid? instructorMembershipId,
        ITimetableService timetable)
    {
        var query = new SessionQuery(
            ParseDate(from ?? throw Required("from"), "from"),
            ParseDate(to ?? throw Required("to"), "to"),
            classTypeId,
            instructorMembershipId);
        var sessions = await timetable.ListSessionsAsync(TenantRouteFilter.Current(httpContext), query, httpContext.RequestAborted);
        return Results.Ok(new SessionListResponse([.. sessions.Select(ToResponse)]));
    }

    private static async Task<IResult> CreateSessionAsync(HttpContext httpContext, CreateSessionRequest request, ITimetableService timetable)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var created = await timetable.CreateSessionAsync(
            tenant,
            new NewSession(
                request.ClassTypeId ?? throw Required("classTypeId"),
                request.LocalDate,
                request.LocalStart is null ? null : ParseTime(request.LocalStart, "localStart"),
                request.Minutes,
                request.InstructorMembershipId,
                request.RoomId,
                request.Capacity),
            httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/sessions/{created.Id}", ToResponse(created));
    }

    private static async Task<IResult> GetSessionAsync(HttpContext httpContext, Guid sessionId, ITimetableService timetable) =>
        Results.Ok(ToResponse(await timetable.GetSessionAsync(TenantRouteFilter.Current(httpContext), sessionId, httpContext.RequestAborted)));

    internal static RoomResponse ToResponse(RoomView r) => new(r.Id, r.Name, r.DefaultCapacity, r.Status, r.Version.ToString(CultureInfo.InvariantCulture));

    internal static ClassTypeResponse ToResponse(ClassTypeView c) =>
        new(c.Id, c.Name, c.Category, c.Color, c.DefaultMinutes, c.Description, c.Status, c.Version.ToString(CultureInfo.InvariantCulture));

    internal static ScheduleTemplateResponse ToResponse(TemplateView t) =>
        new(t.Id, t.ClassTypeId, t.Weekday, t.LocalStart.ToString("HH:mm", CultureInfo.InvariantCulture), t.Minutes, t.InstructorMembershipId, t.RoomId, t.Capacity, t.ValidFrom, t.ValidUntil, t.Version.ToString(CultureInfo.InvariantCulture));

    internal static ScheduleTemplateChangeResponse ToResponse(TemplateChange change) => new(ToResponse(change.Template), [.. change.UntouchedSessions.Select(ToResponse)]);

    internal static SessionResponse ToResponse(SessionView s) =>
        new(
            s.Id,
            s.TemplateId,
            s.LocalDate,
            s.StartsAt,
            s.EndsAt,
            new SessionClassTypeResponse(s.ClassType.Id, s.ClassType.Name, s.ClassType.Category, s.ClassType.Color),
            s.Instructor is { } i ? new InstructorResponse(i.MembershipId, i.DisplayName) : null,
            s.Room is { } r ? new SessionRoomResponse(r.Id, r.Name) : null,
            s.Capacity,
            s.BookedCount,
            s.WaitlistCount,
            s.Status,
            s.MyBooking is { } m ? new MyBookingStateResponse(m.BookingId, m.Status, m.WaitlistPosition, m.FreeCancelUntil) : null,
            s.PassPreview is { } p ? new PassSummaryResponse(p.Id, p.Name, p.Kind, p.EndsOn, p.EntriesLeft) : null,
            s.Version.ToString(CultureInfo.InvariantCulture));

    private static TimeOnly ParseTime(string value, string field) =>
        TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
            ? time
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", "Use HH:MM, e.g. 17:30.", field);

    private static DateOnly ParseDate(string value, string field) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", "Use yyyy-MM-dd.", field);

    private static void RequireObject(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.invalid", "Send a JSON object.");
        }
    }

    private static string? OptionalString(JsonElement body, string name) =>
        body.TryGetProperty(name, out var e) && e.ValueKind != JsonValueKind.Null ? StringOf(e, name) : null;

    private static int? OptionalInt(JsonElement body, string name)
    {
        if (!body.TryGetProperty(name, out var e) || e.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var i) ? i : throw Invalid(name);
    }

    /// <summary>Absent: unchanged. Sent (null included): set.</summary>
    private static Change<T> Nullable<T>(JsonElement body, string name, Func<JsonElement, T> read)
    {
        if (!body.TryGetProperty(name, out var e))
        {
            return default;
        }

        return new Change<T>(true, e.ValueKind == JsonValueKind.Null ? default! : read(e));
    }

    private static string StringOf(JsonElement e, string name) => e.ValueKind == JsonValueKind.String ? e.GetString()! : throw Invalid(name);

    private static Guid? GuidOf(JsonElement e, string name) => e.ValueKind == JsonValueKind.String && e.TryGetGuid(out var g) ? g : throw Invalid(name);

    private static DateOnly? DateOf(JsonElement e, string name) => ParseDate(StringOf(e, name), name);

    private static DomainRuleViolationException Required(string field) =>
        new(ViolationKind.Validation, $"{field}.required", "This field is required.", field);

    private static DomainRuleViolationException Invalid(string field) =>
        new(ViolationKind.Validation, $"{field}.invalid", "This value has the wrong type.", field);
}
