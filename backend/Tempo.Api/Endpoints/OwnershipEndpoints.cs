using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Account;
using Tempo.Contracts.Api.Authorization;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Owner transfer (docs/27 sections 3.5 and 6). Starting one needs
/// `ownership.transfer` and a recent sign-in; the target answers with any
/// membership, and the service checks who is a party to the transfer.
/// </summary>
public static class OwnershipEndpoints
{
    public static IEndpointRouteBuilder MapOwnershipEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/ownership-transfer", GetAsync)
            .RequirePermission(Permissions.OrganizationView)
            .WithName("getOwnershipTransfer")
            .Produces<OwnershipTransferResponse>();

        tenant.MapPost("/ownership-transfer", StartAsync)
            .RequirePermission(Permissions.OwnershipTransfer)
            .WithName("startOwnershipTransfer")
            .Produces<OwnershipTransferResponse>(StatusCodes.Status201Created);

        tenant.MapDelete("/ownership-transfer", CancelAsync)
            .RequirePermission(Permissions.OwnershipTransfer)
            .WithName("cancelOwnershipTransfer")
            .Produces(StatusCodes.Status204NoContent);

        tenant.MapPost("/ownership-transfer/accept", AcceptAsync)
            .RequirePermission(Permissions.OrganizationView)
            .WithName("acceptOwnershipTransfer")
            .Produces<MyMembershipResponse>();

        tenant.MapPost("/ownership-transfer/decline", DeclineAsync)
            .RequirePermission(Permissions.OrganizationView)
            .WithName("declineOwnershipTransfer")
            .Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IOwnershipService ownership) =>
        Results.Ok(ToResponse(await ownership.GetPendingAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> StartAsync(
        HttpContext httpContext,
        StartOwnershipTransferRequest request,
        IOwnershipService ownership,
        TimeProvider clock)
    {
        StepUp.Require(httpContext, clock);
        var started = await ownership.StartAsync(TenantRouteFilter.Current(httpContext), request.ToMembershipId, httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{TenantRouteFilter.Current(httpContext).OrganizationId}/ownership-transfer", ToResponse(started));
    }

    private static async Task<IResult> CancelAsync(HttpContext httpContext, IOwnershipService ownership)
    {
        await ownership.CancelAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> AcceptAsync(HttpContext httpContext, IOwnershipService ownership, IMembershipDirectory memberships)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        await ownership.AcceptAsync(tenant, httpContext.RequestAborted);
        var mine = await memberships.ListForAccountAsync(tenant.UserAccountId, httpContext.RequestAborted);
        return Results.Ok(AccountEndpoints.ToResponse(mine.Single(m => m.MembershipId == tenant.MembershipId)));
    }

    private static async Task<IResult> DeclineAsync(HttpContext httpContext, IOwnershipService ownership)
    {
        await ownership.DeclineAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static OwnershipTransferResponse ToResponse(OwnershipTransferView t) =>
        new(
            t.Id,
            StoredValue.Of(t.Status),
            new MemberRefResponse(t.FromMembershipId, null),
            new MemberRefResponse(t.ToMembershipId, null),
            t.ExpiresAt,
            t.CreatedAt);
}
