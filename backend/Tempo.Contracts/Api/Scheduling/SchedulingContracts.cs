using System.Text.Json.Serialization;

namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`Room` in contracts/openapi/tempo-api.v1.yaml (docs/29).</summary>
public sealed record RoomResponse(Guid Id, string Name, int DefaultCapacity, string Status, string Version);

public sealed record RoomListResponse(IReadOnlyList<RoomResponse> Items);

public sealed record CreateRoomRequest(string? Name, int? DefaultCapacity);

public sealed record UpdateRoomRequest(string? Name, int? DefaultCapacity, string? Status);

/// <summary>`ClassType`.</summary>
public sealed record ClassTypeResponse(Guid Id, string Name, string Category, string Color, int DefaultMinutes, string? Description, string Status, string Version, Uri? CoverUrl = null, Uri? CoverSmallUrl = null);

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
    string Version,
    SessionClassTypeResponse ClassType,
    InstructorResponse? Instructor,
    SessionRoomResponse? Room);

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

public sealed record SessionClassTypeResponse(Guid Id, string Name, string Category, string Color, string? Description = null, Uri? CoverUrl = null, Uri? CoverSmallUrl = null);

public sealed record InstructorResponse(Guid MembershipId, string DisplayName);

public sealed record SessionRoomResponse(Guid Id, string Name, bool SpotSelection = false);

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
    string Version,
    DateOnly? FrozenUntil = null,
    string? MemberNote = null);

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
    string Version,
    IReadOnlyList<PassFreezeResponse> Freezes);

/// <summary>`PassFreeze`: days a membership is frozen, studio dates, inclusive.</summary>
public sealed record PassFreezeResponse(Guid Id, DateOnly StartsOn, DateOnly EndsOn);

/// <summary>`FreezePassRequest` (docs/29 section 16.4).</summary>
public sealed record FreezePassRequest(DateOnly? StartsOn, DateOnly? EndsOn);

public sealed record PassListResponse(IReadOnlyList<PassResponse> Items);

public sealed record GrantPassRequest(Guid? ProductId, DateOnly? StartsOn, string? Note);

public sealed record PersonRefResponse(Guid Id, string DisplayName, Uri? AvatarUrl = null);

/// <summary>`Booking`: a place in a session, or a place in its waitlist.</summary>
public sealed record BookingResponse(
    Guid Id,
    Guid SessionId,
    PersonRefResponse Person,
    string Status,
    int? WaitlistPosition,
    bool LateCancel,
    string? CancelReason,
    PassSummaryResponse? Pass,
    DateTimeOffset CreatedAt,
    string Version,
    string? CancelledFrom = null,
    SpotRefResponse? Spot = null);

/// <summary>`MyBooking`: a booking with its session.</summary>
public sealed record MyBookingResponse(
    Guid Id,
    Guid SessionId,
    PersonRefResponse Person,
    string Status,
    int? WaitlistPosition,
    bool LateCancel,
    string? CancelReason,
    PassSummaryResponse? Pass,
    DateTimeOffset CreatedAt,
    string Version,
    SessionResponse Session,
    string? CancelledFrom = null,
    SpotRefResponse? Spot = null);

public sealed record MyBookingPageResponse(IReadOnlyList<MyBookingResponse> Items, Guid? NextBefore);

public sealed record CreateBookingRequest(Guid? PersonId, Guid? SpotId = null);

/// <summary>`SpotRef`: the spot a booked place holds (docs/33 section 3).</summary>
public sealed record SpotRefResponse(Guid Id, string Label);

/// <summary>`RoomSpot`: one spot of a room's layout.</summary>
public sealed record RoomSpotResponse(Guid Id, string Label, int Row, int Col, string Kind, string Status);

/// <summary>`RoomLayout`: a room's grid, the window, the mirror and its spots.</summary>
public sealed record RoomLayoutResponse(Guid RoomId, bool SpotSelection, int? Rows, int? Cols, string? WindowSide, bool MirrorFront, IReadOnlyList<RoomSpotResponse> Spots, string Version);

public sealed record RoomSpotInput(Guid? Id, string? Label, int? Row, int? Col, string? Kind, string? Status);

/// <summary>`RoomLayoutRequest`: the whole layout; spots left out are retired.</summary>
public sealed record RoomLayoutRequest(bool? SpotSelection, int? Rows, int? Cols, string? WindowSide, bool? MirrorFront, IReadOnlyList<RoomSpotInput>? Spots);

/// <summary>`SessionSpot`: a spot as the caller may see it; person, attendance and health only for staff and the instructor.</summary>
public sealed record SessionSpotResponse(
    Guid Id,
    string Label,
    int Row,
    int Col,
    string Kind,
    string State,
    Guid? BookingId,
    PersonRefResponse? Person,
    string? Attendance,
    string? HealthStatus);

/// <summary>`SessionSpots`: the room map of one class.</summary>
public sealed record SessionSpotsResponse(
    Guid SessionId,
    Guid? RoomId,
    bool SpotSelection,
    int? Rows,
    int? Cols,
    string? WindowSide,
    bool MirrorFront,
    Guid? MySpotId,
    Guid? UsualSpotId,
    IReadOnlyList<SessionSpotResponse> Spots);

public sealed record ChangeSpotRequest(Guid? SpotId);

public sealed record UsualSpotRequest(Guid? SpotId);

public sealed record CancelBookingRequest(bool? ReturnEntry);

/// <summary>`MoveBookingRequest`: the class the booked place moves to (docs/29 section 16.1).</summary>
public sealed record MoveBookingRequest(Guid? SessionId);

public sealed record RosterEntryResponse(Guid BookingId, PersonRefResponse Person, string Status, int? WaitlistPosition, string? PassName, int? EntriesLeft, DateTimeOffset BookedAt, string? HealthStatus = null);

/// <summary>`Roster`: booked and waiting people of one session.</summary>
public sealed record RosterResponse(SessionResponse Session, IReadOnlyList<RosterEntryResponse> Booked, IReadOnlyList<RosterEntryResponse> Waitlisted);

public sealed record AttendanceRequest(string? State);

/// <summary>`BookingPolicy`.</summary>
public sealed record BookingPolicyResponse(int FreeCancelHours, int WaitlistCutoffHours, int BookingHorizonDays, bool WaitlistEnabled, string Version, bool RequireHealthDeclaration = false);

public sealed record BookingPolicyInput(int? FreeCancelHours, int? WaitlistCutoffHours, int? BookingHorizonDays, bool? WaitlistEnabled, bool? RequireHealthDeclaration = null);

/// <summary>`InboxItem.data`: ids only, and only the ones the kind carries (a key that does not apply is left out).</summary>
public sealed record InboxItemDataResponse(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? SessionId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? BookingId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PassId = null);

/// <summary>`InboxItem`: an in-app notification; the data holds ids only.</summary>
public sealed record InboxSessionResponse(Guid Id, DateTimeOffset StartsAt, string ClassTypeName);

public sealed record InboxItemResponse(Guid Id, string Kind, InboxItemDataResponse Data, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt, InboxSessionResponse? Session = null, string? Text = null, string? Title = null, string? Body = null);

/// <summary>`SendSessionMessageRequest`: a short text to everyone registered on a class (docs/29 section 16.2).</summary>
public sealed record SendSessionMessageRequest(string? Text);

/// <summary>`SessionMessage`: what went out, to how many people; never the text back.</summary>
public sealed record SessionMessageResponse(Guid Id, Guid SessionId, int Recipients, DateTimeOffset CreatedAt);

public sealed record InboxPageResponse(IReadOnlyList<InboxItemResponse> Items, int UnreadCount, Guid? NextBefore);

/// <summary>`Instructor`: an instructor's public profile inside the studio (docs/33 section 5).</summary>
public sealed record InstructorProfileResponse(
    Guid MembershipId,
    string DisplayName,
    string? Headline,
    string? Bio,
    string? InstagramHandle,
    string? PlaylistUrl,
    Uri? PhotoUrl,
    Uri? PhotoSmallUrl,
    bool Visible,
    IReadOnlyList<SessionResponse>? NextSessions);

public sealed record InstructorListResponse(IReadOnlyList<InstructorProfileResponse> Items);

public sealed record StaffProfileRequest(string? Headline, string? Bio, string? InstagramHandle, string? PlaylistUrl, bool? Visible);

/// <summary>`MemberNoteRequest`: the instructor's note to a class; null or empty clears it.</summary>
public sealed record MemberNoteRequest(string? Note, bool? ApplyToWeekly);

/// <summary>`MediaUploadRequest`: what the picture is for and its declared type and size.</summary>
public sealed record MediaUploadRequest(string? Purpose, Guid? OwnerId, string? ContentType, int? Bytes);

/// <summary>`MediaUploadTicket`: PUT the file to `uploadUrl` with this `Content-Type`, then finalize.</summary>
public sealed record MediaUploadTicketResponse(Guid MediaId, Uri UploadUrl, string ContentType, DateTimeOffset ExpiresAt);

/// <summary>`Media`: a ready picture.</summary>
public sealed record MediaResponse(Guid Id, string Purpose, Guid OwnerId, Uri Url, Uri SmallUrl, int Width, int Height);

/// <summary>`CheckinClass`: a booked class and when its check-in opens (30 minutes before the start).</summary>
public sealed record CheckinClassResponse(Guid SessionId, Guid BookingId, string ClassName, DateTimeOffset StartsAt, DateTimeOffset OpensAt, string? SpotLabel);

/// <summary>`CheckinCode`: the caller's rotating code (docs/33 section 8); redraw the QR after `validForSeconds`.</summary>
public sealed record CheckinCodeResponse(string Code, int ValidForSeconds, CheckinClassResponse? OpenClass, CheckinClassResponse? NextClass);

public sealed record CheckinRequest(string? Code, Guid? SessionId);

/// <summary>`Checkin`: what the scanner shows.</summary>
public sealed record CheckinResponse(Guid BookingId, Guid SessionId, PersonRefResponse Person, string? SpotLabel, string HealthStatus, bool AlreadyCheckedIn);
