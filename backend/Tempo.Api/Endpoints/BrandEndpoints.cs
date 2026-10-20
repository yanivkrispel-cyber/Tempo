using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Organizations;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The studio's brand (docs/35 section 2, WL1). Any member reads it, because the member app wears it; owners and
/// admins change it. The logo and the icon go through the picture flow (`studio_logo`, `studio_icon`).
/// </summary>
public static class BrandEndpoints
{
    public static IEndpointRouteBuilder MapBrandEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/brand", GetAsync).RequirePermission(Permissions.OrganizationView).WithName("getBrand").Produces<BrandResponse>();
        tenant.MapPut("/brand", UpdateAsync).RequirePermission(Permissions.OrganizationSettingsManage).WithName("updateBrand").Produces<BrandResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IBrandService brands) =>
        Results.Ok(ToResponse(await brands.GetAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateAsync(
        HttpContext httpContext,
        UpdateBrandRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IBrandService brands)
    {
        var updated = await brands.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            new BrandChanges(request.AppName, request.AccentId, request.IconBackground),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static BrandResponse ToResponse(BrandView b) =>
        new(
            b.AppName,
            b.AccentId,
            b.IconBackground,
            MediaLinks.Url(b.LogoMediaId),
            MediaLinks.Url(b.LogoMediaId, small: true),
            MediaLinks.IconUrl(b.IconMediaId),
            b.Customized,
            b.Version.ToString(CultureInfo.InvariantCulture));
}
