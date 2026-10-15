using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Middleware;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Authorization;
using Tempo.Contracts.Api.Organizations;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Studios and members (docs/26 sections 3.2 and 8.2). Role rules live in the
/// services (RolePolicy); these handlers only translate HTTP.
/// </summary>
public static class OrganizationEndpoints
{
    public static IEndpointRouteBuilder MapOrganizationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapAccountGroup().MapPost("/organizations", CreateAsync)
            .WithName("createOrganization")
            .Produces<OrganizationResponse>(StatusCodes.Status201Created);

        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet(string.Empty, GetAsync)
            .RequirePermission(Permissions.OrganizationView)
            .WithName("getOrganization")
            .WithMetadata(new AllowWhenOrganizationSuspendedAttribute())
            .Produces<OrganizationResponse>();

        tenant.MapPatch(string.Empty, UpdateAsync)
            .RequirePermission(Permissions.OrganizationSettingsManage)
            .WithName("updateOrganization")
            .Produces<OrganizationResponse>();

        tenant.MapGet("/members", ListMembersAsync)
            .RequirePermission(Permissions.MembersView)
            .WithName("listMembers")
            .Produces<MemberPageResponse>();

        tenant.MapPatch("/members/{membershipId:guid}", UpdateMemberAsync)
            .RequirePermission(Permissions.MembersManage)
            .WithName("updateMember")
            .Produces<MemberResponse>();

        // Any member may leave; removing someone else is the service's rank rule (members.manage).
        tenant.MapDelete("/members/{membershipId:guid}", RemoveMemberAsync)
            .RequirePermission(Permissions.OrganizationView)
            .WithName("removeMember")
            .Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> CreateAsync(
        HttpContext httpContext,
        CreateOrganizationRequest request,
        IAccountDirectory accounts,
        IOrganizationService organizations)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (caller is null)
        {
            return problem!;
        }

        var created = await organizations.CreateAsync(
            caller,
            new NewOrganization(request.DisplayName ?? string.Empty, request.Slug ?? string.Empty, request.TimeZone, request.DefaultLocale),
            httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier,
            httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{created.Id}", ToResponse(created));
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IOrganizationService organizations) =>
        Results.Ok(ToResponse(await organizations.GetAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateAsync(
        HttpContext httpContext,
        UpdateOrganizationRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IOrganizationService organizations)
    {
        var updated = await organizations.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            new OrganizationChanges(request.DisplayName, request.TimeZone, request.DefaultLocale),
            ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> ListMembersAsync(
        HttpContext httpContext,
        string? role,
        string? status,
        Guid? before,
        int? limit,
        IMemberService members)
    {
        var page = await members.ListAsync(
            TenantRouteFilter.Current(httpContext),
            new MemberQuery(ParseEnum<MembershipRole>(role, "role"), ParseEnum<MembershipStatus>(status, "status"), before, limit ?? 50),
            httpContext.RequestAborted);
        return Results.Ok(new MemberPageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> UpdateMemberAsync(
        HttpContext httpContext,
        Guid membershipId,
        UpdateMemberRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IMemberService members)
    {
        var updated = await members.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            membershipId,
            ParseEnum<MembershipRole>(request.Role, "role"),
            ParseEnum<MembershipStatus>(request.Status, "status"),
            ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> RemoveMemberAsync(HttpContext httpContext, Guid membershipId, IMemberService members)
    {
        await members.RemoveAsync(TenantRouteFilter.Current(httpContext), membershipId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static OrganizationResponse ToResponse(OrganizationView o) =>
        new(
            o.Id,
            o.Slug,
            o.DisplayName,
            StoredValue.Of(o.Status),
            o.CountryCode,
            o.DefaultLocale,
            o.TimeZone,
            o.CurrencyCode,
            o.JoinLinkEnabled,
            o.CreatedAt,
            o.Version.ToString(CultureInfo.InvariantCulture));

    // Phase 2 has system roles only, and RoleAssignments keeps one per membership in step with its role.
    private static RoleSummaryResponse ToResponse(SystemRole r) => new(r.Id, r.Key, r.DisplayName, true);

    internal static MemberResponse ToResponse(MemberView m) =>
        new(
            m.Id,
            m.UserAccountId,
            m.Email,
            m.DisplayName,
            StoredValue.Of(m.Role),
            [ToResponse(SystemRoles.Of(m.Role))],
            m.PersonId,
            StoredValue.Of(m.Status),
            m.JoinedAt,
            m.Version.ToString(CultureInfo.InvariantCulture));

    /// <summary>The contract's `version` in If-Match; quotes and a weak prefix are tolerated.</summary>
    internal static long? ParseVersion(string? ifMatch)
    {
        if (string.IsNullOrWhiteSpace(ifMatch))
        {
            return null;
        }

        var value = ifMatch.Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal))
        {
            value = value[2..];
        }

        return long.TryParse(value.Trim('"'), NumberStyles.None, CultureInfo.InvariantCulture, out var version)
            ? version
            : throw new DomainRuleViolationException(ViolationKind.Validation, "if_match.invalid", "If-Match must be a version you read.", "If-Match");
    }

    /// <summary>The contract's lowercase enum names; anything else is 400 `{field}.invalid`.</summary>
    internal static T? ParseEnum<T>(string? value, string field)
        where T : struct, Enum
    {
        if (value is null)
        {
            return null;
        }

        // Only the contract's lowercase names, never numbers.
        var matches = Enum.GetValues<T>().Where(candidate => string.Equals(StoredValue.Of(candidate), value, StringComparison.Ordinal)).ToList();
        return matches.Count == 1
            ? matches[0]
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", $"Unknown {field}.", field);
    }
}
