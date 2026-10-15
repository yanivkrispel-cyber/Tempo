using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Billing;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Billing;

namespace Tempo.Api.Endpoints;

/// <summary>Thin billing (docs/28 section 8): the studio's billing page and the public plans.</summary>
public static class BillingEndpoints
{
    public static IEndpointRouteBuilder MapBillingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();
        tenant.MapGet("/billing", GetAsync).RequirePermission(Permissions.BillingView).WithName("getBilling").Produces<BillingOverviewResponse>();
        tenant.MapPatch("/billing/account", UpdateAccountAsync).RequirePermission(Permissions.BillingManage).WithName("updateBillingAccount").Produces<BillingOverviewResponse>();

        endpoints.MapAccountGroup().MapGet("/plans", ListPlansAsync).WithName("listPlans").Produces<PlanListResponse>();
        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IBillingService billing) =>
        Results.Ok(ToResponse(await billing.GetAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateAccountAsync(
        HttpContext httpContext,
        UpdateBillingAccountRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IBillingService billing) =>
        Results.Ok(ToResponse(await billing.UpdateAccountAsync(
            TenantRouteFilter.Current(httpContext),
            new BillingAccountChanges(request.BillingEmail, request.LegalName, request.BusinessId),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted)));

    private static async Task<IResult> ListPlansAsync(HttpContext httpContext, IBillingService billing) =>
        Results.Ok(new PlanListResponse([.. (await billing.ListPublicPlansAsync(httpContext.RequestAborted)).Select(ToResponse)]));

    private static PlanVersionResponse ToResponse(PlanVersionView p) => new(p.Id, p.PlanKey, p.DisplayName, p.PriceMinor, p.Currency, p.Interval, p.Entitlements);

    private static BillingOverviewResponse ToResponse(BillingOverviewView b) =>
        new(
            ToResponse(b.Plan),
            b.State,
            b.Provider,
            b.TrialEndsAt,
            b.CurrentPeriodEnd,
            b.GraceEndsAt,
            b.BillingEmail,
            b.LegalName,
            b.BusinessId,
            b.CardLast4,
            b.Entitlements,
            b.Version.ToString(CultureInfo.InvariantCulture));
}
