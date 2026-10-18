using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Buddies by mutual consent (docs/33 section 4, D18). Every route acts on the caller's own person record; a member
/// needs only `schedule.view`, the same permission that lets them book.
/// </summary>
public static class BuddyEndpoints
{
    public static IEndpointRouteBuilder MapBuddyEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapPost("/me/buddy-code", NewCodeAsync).RequirePermission(Permissions.ScheduleView).WithName("createBuddyCode").Produces<BuddyCodeResponse>();
        tenant.MapGet("/me/buddies", ListAsync).RequirePermission(Permissions.ScheduleView).WithName("listMyBuddies").Produces<BuddyListResponse>();
        tenant.MapPost("/me/buddies", LinkAsync).RequirePermission(Permissions.ScheduleView).WithName("linkBuddy").Produces<BuddyResponse>();
        tenant.MapDelete("/me/buddies/{personId:guid}", UnlinkAsync).RequirePermission(Permissions.ScheduleView).WithName("unlinkBuddy").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> NewCodeAsync(HttpContext httpContext, IBuddyService buddies)
    {
        var code = await buddies.NewCodeAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.Ok(new BuddyCodeResponse(code.Code, code.ExpiresAt));
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, IBuddyService buddies) =>
        Results.Ok(new BuddyListResponse([.. (await buddies.ListAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> LinkAsync(HttpContext httpContext, LinkBuddyRequest request, IBuddyService buddies) =>
        Results.Ok(ToResponse(await buddies.LinkAsync(TenantRouteFilter.Current(httpContext), request.Code, httpContext.RequestAborted)));

    private static async Task<IResult> UnlinkAsync(HttpContext httpContext, Guid personId, IBuddyService buddies)
    {
        await buddies.UnlinkAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static BuddyResponse ToResponse(BuddyView b) => new(b.PersonId, b.DisplayName, b.Since);
}
