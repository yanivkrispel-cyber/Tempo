using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Authorization;
using Tempo.Contracts.Api.Organizations;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Roles and the permission catalog (docs/27 sections 3.2, 3.3 and 6). Phase 2
/// has the four system roles only (A-1), so a member holds exactly one role and
/// setting it goes through the same rules as Phase 1's role change: nobody
/// grants owner, nobody changes their own roles, an admin assigns only staff
/// and client. Granting admin needs a recent sign-in (section 3.6).
/// </summary>
public static class RoleEndpoints
{
    public static IEndpointRouteBuilder MapRoleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/roles", ListRoles)
            .RequirePermission(Permissions.MembersView)
            .WithName("listRoles")
            .Produces<RoleListResponse>();

        tenant.MapGet("/permissions", ListPermissions)
            .RequirePermission(Permissions.RolesManage)
            .WithName("listPermissions")
            .Produces<PermissionListResponse>();

        tenant.MapPut("/members/{membershipId:guid}/roles", SetMemberRolesAsync)
            .RequirePermission(Permissions.MembersManage)
            .WithName("setMemberRoles")
            .Produces<MemberResponse>();

        return endpoints;
    }

    private static IResult ListRoles() =>
        Results.Ok(new RoleListResponse(
        [
            .. SystemRoles.All.Select(r => new RoleDetailResponse(r.Id, r.Key, r.DisplayName, true, [.. r.Permissions.Order(StringComparer.Ordinal)]))
        ]));

    private static IResult ListPermissions() =>
        Results.Ok(new PermissionListResponse([.. Permissions.Catalog.Select(p => new PermissionResponse(p.Key, p.Value))]));

    private static async Task<IResult> SetMemberRolesAsync(
        HttpContext httpContext,
        Guid membershipId,
        SetMemberRolesRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IMemberService members,
        TimeProvider clock)
    {
        var role = SingleSystemRole(request.RoleIds);
        if (role == MembershipRole.Admin)
        {
            // Rank first, so nobody is sent through sign-in for a change they may not make anyway
            // (review on #68): only the owner grants admin (RolePolicy.CanChangeMember).
            if (TenantRouteFilter.Current(httpContext).Role != MembershipRole.Owner)
            {
                throw new DomainRuleViolationException(ViolationKind.Forbidden, "membership.forbidden_role_change", "You cannot change this member.");
            }

            StepUp.Require(httpContext, clock);
        }

        var updated = await members.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            membershipId,
            role,
            null,
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(OrganizationEndpoints.ToResponse(updated));
    }

    /// <summary>Phase 2 accepts one system role id; custom roles and sets of several come with A-1's follow-up.</summary>
    private static MembershipRole SingleSystemRole(IReadOnlyList<Guid>? roleIds)
    {
        if (roleIds is null || roleIds.Count == 0)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "role_ids.required", "Choose a role.", "roleIds");
        }

        if (roleIds.Distinct().Count() != 1)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "role_ids.single", "A member holds one role.", "roleIds");
        }

        return SystemRoles.All.FirstOrDefault(r => r.Id == roleIds[0])?.Role
            ?? throw new DomainRuleViolationException(ViolationKind.Validation, "role.not_found", "Unknown role.", "roleIds");
    }
}
