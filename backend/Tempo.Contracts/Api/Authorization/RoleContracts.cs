namespace Tempo.Contracts.Api.Authorization;

/// <summary>`RoleDetail`: a role with its permission keys.</summary>
public sealed record RoleDetailResponse(Guid Id, string Key, string DisplayName, bool IsSystem, IReadOnlyList<string> Permissions);

/// <summary>`RoleList`.</summary>
public sealed record RoleListResponse(IReadOnlyList<RoleDetailResponse> Items);

/// <summary>`Permission`: a catalog key and what it allows.</summary>
public sealed record PermissionResponse(string Key, string Description);

/// <summary>`PermissionList`.</summary>
public sealed record PermissionListResponse(IReadOnlyList<PermissionResponse> Items);

/// <summary>`SetMemberRolesRequest`: the member's full set of roles.</summary>
public sealed record SetMemberRolesRequest(IReadOnlyList<Guid>? RoleIds);

/// <summary>`MemberRef`: a membership and, when known, its display name.</summary>
public sealed record MemberRefResponse(Guid MembershipId, string? DisplayName);

/// <summary>`OwnershipTransfer`.</summary>
public sealed record OwnershipTransferResponse(
    Guid Id,
    string Status,
    MemberRefResponse From,
    MemberRefResponse To,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt);

/// <summary>`StartOwnershipTransferRequest`.</summary>
public sealed record StartOwnershipTransferRequest(Guid ToMembershipId);
