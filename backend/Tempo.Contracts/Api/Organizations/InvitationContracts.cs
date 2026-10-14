namespace Tempo.Contracts.Api.Organizations;

public sealed record InvitedByResponse(Guid MembershipId, string? DisplayName);

/// <summary>`Invitation`. Status `expired` is a pending invitation past its expiry.</summary>
public sealed record InvitationResponse(
    Guid Id,
    string Email,
    string Role,
    string Status,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt,
    InvitedByResponse InvitedBy);

/// <summary>`CreatedInvitation`: the invitation plus its link, shown once.</summary>
public sealed record CreatedInvitationResponse(
    Guid Id,
    string Email,
    string Role,
    string Status,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt,
    InvitedByResponse InvitedBy,
    string Link);

public sealed record InvitationPageResponse(IReadOnlyList<InvitationResponse> Items, Guid? NextBefore);

public sealed record CreateInvitationRequest(string? Email, string? Role);

/// <summary>`TokenRequest`: the token travels in the body, never in a URL (docs/26 section 5.3).</summary>
public sealed record TokenRequest(string? Token);

public sealed record JoinCodeRequest(string? Code);

public sealed record OrganizationRefResponse(Guid Id, string DisplayName);

public sealed record InvitationPreviewResponse(OrganizationRefResponse Organization, string Role, string? InvitedByDisplayName, DateTimeOffset ExpiresAt);

public sealed record JoinPreviewResponse(OrganizationRefResponse Organization);

/// <summary>`JoinLink`: shown only when created or rotated.</summary>
public sealed record JoinLinkResponse(string Link, DateTimeOffset CreatedAt);
