using System.Globalization;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>Punch cards and memberships (docs/29 sections 5 and 9). The service holds the rules.</summary>
public static class PassEndpoints
{
    public static IEndpointRouteBuilder MapPassEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/pass-products", ListProductsAsync).RequirePermission(Permissions.PassesView).WithName("listPassProducts").Produces<PassProductListResponse>();
        tenant.MapPost("/pass-products", CreateProductAsync).RequirePermission(Permissions.PassesManage).WithName("createPassProduct").Produces<PassProductResponse>(StatusCodes.Status201Created);
        tenant.MapPost("/pass-products/{productId:guid}/archive", ArchiveProductAsync).RequirePermission(Permissions.PassesManage).WithName("archivePassProduct").Produces<PassProductResponse>();
        tenant.MapGet("/people/{personId:guid}/passes", ListForPersonAsync).RequirePermission(Permissions.PassesView).WithName("listPersonPasses").Produces<PassListResponse>();
        tenant.MapPost("/people/{personId:guid}/passes", GrantAsync).RequirePermission(Permissions.PassesManage).WithName("grantPass").Produces<PassResponse>(StatusCodes.Status201Created);
        tenant.MapPost("/passes/{passId:guid}/void", VoidAsync).RequirePermission(Permissions.PassesManage).WithName("voidPass").Produces<PassResponse>();
        tenant.MapPost("/passes/{passId:guid}/freezes", FreezeAsync).RequirePermission(Permissions.PassesManage).WithName("freezePass").Produces<PassResponse>(StatusCodes.Status201Created);
        tenant.MapDelete("/passes/{passId:guid}/freezes/{freezeId:guid}", UnfreezeAsync).RequirePermission(Permissions.PassesManage).WithName("unfreezePass").Produces<PassResponse>();
        tenant.MapGet("/me/passes", ListMineAsync).RequirePermission(Permissions.ScheduleView).WithName("listMyPasses").Produces<PassListResponse>();

        return endpoints;
    }

    private static async Task<IResult> ListProductsAsync(HttpContext httpContext, IPassService passes) =>
        Results.Ok(new PassProductListResponse([.. (await passes.ListProductsAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> CreateProductAsync(HttpContext httpContext, CreatePassProductRequest request, IPassService passes)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var created = await passes.CreateProductAsync(
            tenant,
            new NewPassProduct(request.Kind, request.Name, request.Entries, request.ValidDays, request.WeeklyCap, request.ClassCategory, request.PriceAgorot),
            httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/pass-products/{created.Id}", ToResponse(created));
    }

    private static async Task<IResult> ArchiveProductAsync(HttpContext httpContext, Guid productId, IPassService passes) =>
        Results.Ok(ToResponse(await passes.ArchiveProductAsync(TenantRouteFilter.Current(httpContext), productId, httpContext.RequestAborted)));

    private static async Task<IResult> ListForPersonAsync(HttpContext httpContext, Guid personId, IPassService passes) =>
        Results.Ok(new PassListResponse([.. (await passes.ListForPersonAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> ListMineAsync(HttpContext httpContext, IPassService passes) =>
        Results.Ok(new PassListResponse([.. (await passes.ListMineAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> GrantAsync(HttpContext httpContext, Guid personId, GrantPassRequest request, IPassService passes)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var productId = request.ProductId
            ?? throw new DomainRuleViolationException(ViolationKind.Validation, "productId.required", "Choose a product.", "productId");
        var granted = await passes.GrantAsync(tenant, personId, new NewPass(productId, request.StartsOn, request.Note), httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/people/{personId}/passes/{granted.Id}", ToResponse(granted));
    }

    private static async Task<IResult> VoidAsync(HttpContext httpContext, Guid passId, IPassService passes) =>
        Results.Ok(ToResponse(await passes.VoidAsync(TenantRouteFilter.Current(httpContext), passId, httpContext.RequestAborted)));

    private static async Task<IResult> FreezeAsync(HttpContext httpContext, Guid passId, FreezePassRequest request, IPassService passes)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var frozen = await passes.FreezeAsync(tenant, passId, new NewFreeze(request.StartsOn, request.EndsOn), httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/passes/{passId}", ToResponse(frozen));
    }

    private static async Task<IResult> UnfreezeAsync(HttpContext httpContext, Guid passId, Guid freezeId, IPassService passes) =>
        Results.Ok(ToResponse(await passes.UnfreezeAsync(TenantRouteFilter.Current(httpContext), passId, freezeId, httpContext.RequestAborted)));

    internal static PassProductResponse ToResponse(PassProductView p) =>
        new(p.Id, p.Kind, p.Name, p.Entries, p.ValidDays, p.WeeklyCap, p.ClassCategory, p.PriceAgorot, p.Status, p.Version.ToString(CultureInfo.InvariantCulture));

    internal static PassResponse ToResponse(PassView p) =>
        new(
            p.Id,
            p.PersonId,
            new PassProductRefResponse(p.Product.Id, p.Product.Name, p.Product.Kind, p.Product.WeeklyCap, p.Product.ClassCategory),
            p.StartsOn,
            p.EndsOn,
            p.Entries,
            p.EntriesUsed,
            p.EntriesLeft,
            p.Note,
            p.Status,
            p.CreatedAt,
            p.Version.ToString(CultureInfo.InvariantCulture),
            [.. (p.Freezes ?? []).Select(f => new PassFreezeResponse(f.Id, f.StartsOn, f.EndsOn))]);
}
