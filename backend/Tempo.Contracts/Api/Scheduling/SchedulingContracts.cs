namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`Room` in contracts/openapi/tempo-api.v1.yaml (docs/29).</summary>
public sealed record RoomResponse(Guid Id, string Name, int DefaultCapacity, string Status, string Version);

public sealed record RoomListResponse(IReadOnlyList<RoomResponse> Items);

public sealed record CreateRoomRequest(string? Name, int? DefaultCapacity);

public sealed record UpdateRoomRequest(string? Name, int? DefaultCapacity, string? Status);

/// <summary>`ClassType`.</summary>
public sealed record ClassTypeResponse(Guid Id, string Name, string Category, string Color, int DefaultMinutes, string? Description, string Status, string Version);

public sealed record ClassTypeListResponse(IReadOnlyList<ClassTypeResponse> Items);

public sealed record CreateClassTypeRequest(string? Name, string? Category, string? Color, int? DefaultMinutes, string? Description);

/// <summary>`ScheduleTemplate`: a weekly class; `LocalStart` is `HH:MM` in the studio's time zone.</summary>
public sealed record ScheduleTemplateResponse(
    Guid Id,
    Guid ClassTypeId,
    int Weekday,
    string LocalStart,
    int Minutes,
    Guid? InstructorMembershipId,
    Guid? RoomId,
    int Capacity,
    DateOnly ValidFrom,
    DateOnly? ValidUntil,
    string Version);

public sealed record ScheduleTemplateListResponse(IReadOnlyList<ScheduleTemplateResponse> Items);

public sealed record CreateScheduleTemplateRequest(
    Guid? ClassTypeId,
    int? Weekday,
    string? LocalStart,
    int? Minutes,
    Guid? InstructorMembershipId,
    Guid? RoomId,
    int? Capacity,
    DateOnly? ValidFrom,
    DateOnly? ValidUntil);

public sealed record ScheduleTemplateChangeResponse(ScheduleTemplateResponse Template, IReadOnlyList<SessionResponse> UntouchedSessions);

public sealed record SessionClassTypeResponse(Guid Id, string Name, string Category, string Color);

public sealed record InstructorResponse(Guid MembershipId, string DisplayName);

public sealed record SessionRoomResponse(Guid Id, string Name);

public sealed record MyBookingStateResponse(Guid BookingId, string Status, int? WaitlistPosition, DateTimeOffset? FreeCancelUntil);

public sealed record PassSummaryResponse(Guid Id, string Name, string Kind, DateOnly EndsOn, int? EntriesLeft);

/// <summary>`Session`: one class on one date, with the caller's own booking state.</summary>
public sealed record SessionResponse(
    Guid Id,
    Guid? TemplateId,
    DateOnly LocalDate,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    SessionClassTypeResponse ClassType,
    InstructorResponse? Instructor,
    SessionRoomResponse? Room,
    int Capacity,
    int BookedCount,
    int WaitlistCount,
    string Status,
    MyBookingStateResponse? MyBooking,
    PassSummaryResponse? PassPreview,
    string Version);

public sealed record SessionListResponse(IReadOnlyList<SessionResponse> Items);

public sealed record CreateSessionRequest(
    Guid? ClassTypeId,
    DateOnly? LocalDate,
    string? LocalStart,
    int? Minutes,
    Guid? InstructorMembershipId,
    Guid? RoomId,
    int? Capacity);

/// <summary>`PassProduct`: a punch card or membership the studio sells.</summary>
public sealed record PassProductResponse(
    Guid Id,
    string Kind,
    string Name,
    int? Entries,
    int ValidDays,
    int? WeeklyCap,
    string? ClassCategory,
    int? PriceAgorot,
    string Status,
    string Version);

public sealed record PassProductListResponse(IReadOnlyList<PassProductResponse> Items);

public sealed record CreatePassProductRequest(string? Kind, string? Name, int? Entries, int? ValidDays, int? WeeklyCap, string? ClassCategory, int? PriceAgorot);

public sealed record PassProductRefResponse(Guid Id, string Name, string Kind, int? WeeklyCap, string? ClassCategory);

/// <summary>`Pass`: a product granted to one person.</summary>
public sealed record PassResponse(
    Guid Id,
    Guid PersonId,
    PassProductRefResponse Product,
    DateOnly StartsOn,
    DateOnly EndsOn,
    int? Entries,
    int EntriesUsed,
    int? EntriesLeft,
    string? Note,
    string Status,
    DateTimeOffset CreatedAt,
    string Version);

public sealed record PassListResponse(IReadOnlyList<PassResponse> Items);

public sealed record GrantPassRequest(Guid? ProductId, DateOnly? StartsOn, string? Note);
