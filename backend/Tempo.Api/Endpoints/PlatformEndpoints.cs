using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Platform;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.PlatformAdmin;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The operator console (docs/26 section 8.4) and a studio's own audit log
/// (section 8.2).
/// </summary>
public static class PlatformEndpoints
{
    public static IEndpointRouteBuilder MapPlatformEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var platform = endpoints.MapPlatformGroup();
        platform.MapGet("/organizations", ListAsync).WithName("platformListOrganizations").Produces<PlatformOrganizationPageResponse>();
        platform.MapGet("/organizations/{organizationId:guid}", GetAsync).WithName("platformGetOrganization").Produces<PlatformOrganizationResponse>();
        platform.MapPost("/organizations/{organizationId:guid}/suspend", SuspendAsync).WithName("platformSuspendOrganization").Produces<PlatformOrganizationResponse>();
        platform.MapPost("/organizations/{organizationId:guid}/reactivate", ReactivateAsync).WithName("platformReactivateOrganization").Produces<PlatformOrganizationResponse>();
        platform.MapGet("/stats", StatsAsync).WithName("platformGetStats").Produces<PlatformStatsResponse>();

        endpoints.MapTenantGroup().MapGet("/audit-events", ListAuditEventsAsync).RequirePermission(Permissions.AuditView).WithName("listAuditEvents").Produces<AuditEventPageResponse>();

        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, string? status, Guid? before, int? limit, IPlatformService platform)
    {
        var page = await platform.ListAsync(OrganizationEndpoints.ParseEnum<OrganizationStatus>(status, "status"), before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(new PlatformOrganizationPageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, Guid organizationId, IPlatformService platform) =>
        Results.Ok(ToResponse(await platform.GetAsync(OperatorRouteFilter.Current(httpContext), organizationId, httpContext.RequestAborted)));

    private static Task<IResult> SuspendAsync(HttpContext httpContext, Guid organizationId, ReasonRequest request, IPlatformService platform) =>
        SetStatusAsync(httpContext, organizationId, OrganizationStatus.Suspended, request, platform);

    private static Task<IResult> ReactivateAsync(HttpContext httpContext, Guid organizationId, ReasonRequest request, IPlatformService platform) =>
        SetStatusAsync(httpContext, organizationId, OrganizationStatus.Active, request, platform);

    private static async Task<IResult> SetStatusAsync(HttpContext httpContext, Guid organizationId, OrganizationStatus status, ReasonRequest request, IPlatformService platform)
    {
        var updated = await platform.SetStatusAsync(OperatorRouteFilter.Current(httpContext), organizationId, status, request.Reason ?? string.Empty, httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> StatsAsync(HttpContext httpContext, IPlatformService platform)
    {
        var s = await platform.StatsAsync(httpContext.RequestAborted);
        return Results.Ok(new PlatformStatsResponse(s.ActiveOrganizations, s.SuspendedOrganizations, s.Accounts, s.ActiveMemberships, s.HourlyBackupThreshold));
    }

    private static async Task<IResult> ListAuditEventsAsync(HttpContext httpContext, Guid? before, int? limit, IAuditService audit)
    {
        var page = await audit.ListAsync(TenantRouteFilter.Current(httpContext), before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(new AuditEventPageResponse(
            [.. page.Items.Select(e => new AuditEventResponse(e.Id, e.OccurredAt, e.ActorType, e.ActorDisplayName, e.Action, e.TargetType, e.TargetId, e.Data))],
            page.NextBefore));
    }

    private static PlatformOrganizationResponse ToResponse(PlatformOrganizationView o) =>
        new(
            o.Id,
            o.Slug,
            o.DisplayName,
            StoredValue.Of(o.Status),
            o.CreatedAt,
            new PlatformOwnerResponse(o.OwnerAccountId, o.OwnerEmail, o.OwnerDisplayName),
            new MemberCountsResponse(o.MemberCounts.Owner, o.MemberCounts.Admin, o.MemberCounts.Staff, o.MemberCounts.Client));
}
