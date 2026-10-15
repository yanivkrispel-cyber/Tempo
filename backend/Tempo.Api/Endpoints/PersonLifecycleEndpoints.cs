using System.Globalization;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Duplicate candidates and merge, export and erasure (docs/27 sections 4.6,
/// 4.7 and 6). Export and erase need a sign-in within ten minutes.
/// </summary>
public static class PersonLifecycleEndpoints
{
    public static IEndpointRouteBuilder MapPersonLifecycleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/duplicate-candidates", ListAsync).RequirePermission(Permissions.PeopleMerge).WithName("listDuplicateCandidates").Produces<DuplicateCandidatePageResponse>();
        tenant.MapPost("/duplicate-candidates/{candidateId:guid}/resolve", ResolveAsync).RequirePermission(Permissions.PeopleMerge).WithName("resolveDuplicateCandidate").Produces<DuplicateCandidateResponse>();
        tenant.MapPost("/people/{personId:guid}/export", ExportAsync).RequirePermission(Permissions.PeopleExport).WithName("exportPerson").WithMetadata(new AllowWhenSubscriptionRestrictedAttribute()).Produces<PersonExportResponse>();
        tenant.MapPost("/people/{personId:guid}/erase", EraseAsync).RequirePermission(Permissions.PeopleErase).WithName("erasePerson").Produces<PersonDetailResponse>();

        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, string? status, Guid? before, int? limit, IPersonLifecycleService lifecycle)
    {
        var page = await lifecycle.ListCandidatesAsync(TenantRouteFilter.Current(httpContext), status, before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(new DuplicateCandidatePageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> ResolveAsync(HttpContext httpContext, Guid candidateId, ResolveDuplicateRequest request, IPersonLifecycleService lifecycle)
    {
        var resolved = await lifecycle.ResolveAsync(TenantRouteFilter.Current(httpContext), candidateId, request.Resolution, request.SurvivorPersonId, httpContext.RequestAborted);
        return Results.Ok(ToResponse(resolved));
    }

    private static async Task<IResult> ExportAsync(HttpContext httpContext, Guid personId, IPersonLifecycleService lifecycle, TimeProvider clock)
    {
        StepUp.Require(httpContext, clock);
        var export = await lifecycle.ExportAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted);
        return Results.Ok(new PersonExportResponse(
            export.ExportedAt,
            new ExportOrganizationResponse(export.OrganizationId, export.OrganizationName),
            PeopleEndpoints.ToResponse(export.Person),
            [.. export.ConsentHistory.Select(PeopleEndpoints.ToResponse)]));
    }

    private static async Task<IResult> EraseAsync(HttpContext httpContext, Guid personId, ErasePersonRequest request, IPersonLifecycleService lifecycle, TimeProvider clock)
    {
        StepUp.Require(httpContext, clock);
        var erased = await lifecycle.EraseAsync(TenantRouteFilter.Current(httpContext), personId, request.Reason ?? string.Empty, httpContext.RequestAborted);
        return Results.Ok(PeopleEndpoints.ToResponse(erased));
    }

    private static DuplicateCandidateResponse ToResponse(DuplicateCandidateView d) =>
        new(d.Id, d.Reason, d.Status, PeopleEndpoints.ToResponse(d.PersonA), PeopleEndpoints.ToResponse(d.PersonB), d.CreatedAt, d.Version.ToString(CultureInfo.InvariantCulture));
}
