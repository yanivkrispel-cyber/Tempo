using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Marketing;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Marketing;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Studio marketing, stage A (docs/37): the public page settings. Any member of the studio may read whether the page
/// is on (the console's "פרסום" builds links from it); owners and admins change it.
/// </summary>
public static class MarketingEndpoints
{
    public static IEndpointRouteBuilder MapMarketingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/public-page", GetAsync).RequirePermission(Permissions.OrganizationView).WithName("getPublicPage").Produces<PublicPageResponse>();
        tenant.MapPut("/public-page", UpdateAsync).RequirePermission(Permissions.OrganizationSettingsManage).WithName("updatePublicPage").Produces<PublicPageResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IPublicPageService pages) =>
        Results.Ok(ToResponse(await pages.GetAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateAsync(
        HttpContext httpContext,
        UpdatePublicPageRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IPublicPageService pages)
    {
        var updated = await pages.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            new PublicPageChanges(request.Enabled, request.OpenJoin, request.IntroProductId, request.SuggestWeeklyAt),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static PublicPageResponse ToResponse(PublicPageView p) =>
        new(p.Enabled, p.OpenJoin, p.IntroProductId, p.SuggestWeeklyAt, p.Version.ToString(CultureInfo.InvariantCulture));
}
