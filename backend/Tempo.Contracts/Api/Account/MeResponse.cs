using Tempo.Contracts.Api.Authorization;

namespace Tempo.Contracts.Api.Account;

/// <summary>
/// The caller's account and studios: `Me` in contracts/openapi/tempo-api.v1.yaml.
/// Returned by POST /api/v1/session, GET /api/v1/me and PATCH /api/v1/me.
/// </summary>
public sealed record MeResponse(
    Guid Id,
    string Email,
    bool EmailVerified,
    string? DisplayName,
    string Locale,
    string Status,
    IReadOnlyList<MyMembershipResponse> Memberships);

/// <summary>
/// One studio the caller belongs to, for the studio switcher (`MyMembership`).
/// `Role` is the Phase 1 field, kept one release; apps read `Roles` and `Permissions`.
/// </summary>
public sealed record MyMembershipResponse(
    Guid MembershipId,
    string Role,
    IReadOnlyList<RoleSummaryResponse> Roles,
    IReadOnlyList<string> Permissions,
    PendingOwnershipTransferResponse? PendingOwnershipTransfer,
    string Status,
    MyOrganizationResponse Organization);

public sealed record MyOrganizationResponse(Guid Id, string Slug, string DisplayName, string Status);

/// <summary>PATCH /api/v1/me (`UpdateMeRequest`). At least one field.</summary>
public sealed record UpdateMeRequest(string? DisplayName, string? Locale);
