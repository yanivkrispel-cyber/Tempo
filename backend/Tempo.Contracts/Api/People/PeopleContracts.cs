using Tempo.Contracts.Api.Authorization;

namespace Tempo.Contracts.Api.People;

/// <summary>`Person` in contracts/openapi/tempo-api.v1.yaml (Phase 2).</summary>
public sealed record PersonResponse(
    Guid Id,
    string DisplayName,
    string? GivenName,
    string? FamilyName,
    DateOnly? BirthDate,
    string Status,
    string Source,
    bool HasLogin,
    Guid? MembershipId,
    string? PrimaryEmail,
    string? PrimaryPhone,
    Guid? MergedIntoId,
    DateTimeOffset CreatedAt,
    string Version);

/// <summary>`PersonDetail`: the person with contacts, current consent and relationships.</summary>
public sealed record PersonDetailResponse(
    Guid Id,
    string DisplayName,
    string? GivenName,
    string? FamilyName,
    DateOnly? BirthDate,
    string Status,
    string Source,
    bool HasLogin,
    Guid? MembershipId,
    string? PrimaryEmail,
    string? PrimaryPhone,
    Guid? MergedIntoId,
    DateTimeOffset CreatedAt,
    string Version,
    IReadOnlyList<ContactPointResponse> ContactPoints,
    IReadOnlyList<ConsentResponse> Consents,
    IReadOnlyList<RelationshipResponse> Relationships);

public sealed record PersonPageResponse(IReadOnlyList<PersonResponse> Items, Guid? NextBefore);

public sealed record ContactPointResponse(Guid Id, string Type, string Value, bool IsPrimary, bool Verified, string Version);

public sealed record ConsentResponse(
    Guid Id,
    string Purpose,
    string Channel,
    string State,
    string Method,
    string TextVersion,
    MemberRefResponse? RecordedBy,
    DateTimeOffset OccurredAt);

public sealed record RelationshipResponse(Guid Id, string Type, Guid FromPersonId, Guid ToPersonId, string OtherDisplayName, DateTimeOffset CreatedAt);

/// <summary>`CreatePersonRequest`: a display name and at least one of email or phone (P-6).</summary>
public sealed record CreatePersonRequest(string? DisplayName, string? GivenName, string? FamilyName, DateOnly? BirthDate, string? Email, string? Phone);

/// <summary>`CreateContactPointRequest`.</summary>
public sealed record CreateContactPointRequest(string? Type, string? Value, bool? IsPrimary);

/// <summary>`UpdateContactPointRequest`.</summary>
public sealed record UpdateContactPointRequest(string? Value, bool? IsPrimary);

/// <summary>`RecordConsentRequest`: purpose marketing or reminders, channel email, push or whatsapp.</summary>
public sealed record RecordConsentRequest(string? Purpose, string? Channel, string? State, string? TextVersion);

/// <summary>`ConsentList`: the full history, newest first.</summary>
public sealed record ConsentListResponse(IReadOnlyList<ConsentResponse> Items);

/// <summary>`CreateRelationshipRequest`: the person in the path is the `from` side.</summary>
public sealed record CreateRelationshipRequest(string? Type, Guid ToPersonId);

/// <summary>`DuplicateCandidate`.</summary>
public sealed record DuplicateCandidateResponse(Guid Id, string Reason, string Status, PersonResponse PersonA, PersonResponse PersonB, DateTimeOffset CreatedAt, string Version);

/// <summary>`DuplicateCandidatePage`.</summary>
public sealed record DuplicateCandidatePageResponse(IReadOnlyList<DuplicateCandidateResponse> Items, Guid? NextBefore);

/// <summary>`ResolveDuplicateRequest`: survivorPersonId is required to merge.</summary>
public sealed record ResolveDuplicateRequest(string? Resolution, Guid? SurvivorPersonId);

public sealed record ExportOrganizationResponse(Guid Id, string DisplayName);

/// <summary>`ExportBooking`: one booking in the export, with the class name and when it starts.</summary>
public sealed record ExportBookingResponse(Guid Id, Guid SessionId, string ClassName, DateTimeOffset StartsAt, string Status, bool LateCancel, string? CancelReason, DateTimeOffset CreatedAt);

/// <summary>`ExportPass`: one pass in the export, with the product's name and kind.</summary>
public sealed record ExportPassResponse(Guid Id, string ProductName, string Kind, DateOnly StartsOn, DateOnly EndsOn, int? Entries, int EntriesUsed, string Status, DateTimeOffset CreatedAt);

/// <summary>`PersonExport`: everything the studio holds about one person.</summary>
public sealed record PersonExportResponse(
    DateTimeOffset ExportedAt,
    ExportOrganizationResponse Organization,
    PersonDetailResponse Person,
    IReadOnlyList<ConsentResponse> ConsentHistory,
    IReadOnlyList<ExportBookingResponse> Bookings,
    IReadOnlyList<ExportPassResponse> Passes);

/// <summary>The body of erase (`ReasonRequest`).</summary>
public sealed record ErasePersonRequest(string? Reason);

/// <summary>`InvitePersonRequest`: where the person will sign in; added as a contact if new.</summary>
public sealed record InvitePersonRequest(string? Email);
