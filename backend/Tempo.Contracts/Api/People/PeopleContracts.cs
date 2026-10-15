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
