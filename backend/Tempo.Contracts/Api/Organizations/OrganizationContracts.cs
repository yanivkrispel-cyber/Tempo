namespace Tempo.Contracts.Api.Organizations;

/// <summary>`Organization` in contracts/openapi/tempo-api.v1.yaml. Send `Version` back in If-Match.</summary>
public sealed record OrganizationResponse(
    Guid Id,
    string Slug,
    string DisplayName,
    string Status,
    string CountryCode,
    string DefaultLocale,
    string TimeZone,
    string CurrencyCode,
    bool JoinLinkEnabled,
    DateTimeOffset CreatedAt,
    string Version);

public sealed record CreateOrganizationRequest(string? DisplayName, string? Slug, string? TimeZone, string? DefaultLocale);

public sealed record UpdateOrganizationRequest(string? DisplayName, string? TimeZone, string? DefaultLocale);

/// <summary>`Member`: a membership with the person's name and email.</summary>
public sealed record MemberResponse(
    Guid Id,
    Guid UserAccountId,
    string Email,
    string? DisplayName,
    string Role,
    string Status,
    DateTimeOffset JoinedAt,
    string Version);

public sealed record MemberPageResponse(IReadOnlyList<MemberResponse> Items, Guid? NextBefore);

/// <summary>`UpdateMemberRequest`: role is admin, staff or client; status is active or suspended.</summary>
public sealed record UpdateMemberRequest(string? Role, string? Status);
