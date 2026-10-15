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
