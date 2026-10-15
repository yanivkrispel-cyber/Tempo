using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The caller's own profile and consent in a studio (any member, the self
/// rule), consent history and consent on someone's behalf, and relationships
/// (docs/27 sections 4.3, 4.4 and 6).
/// </summary>
public static class ConsentEndpoints
{
    public static IEndpointRouteBuilder MapConsentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/me/profile", GetMyProfileAsync).RequirePermission(Permissions.OrganizationView).WithName("getMyProfile").Produces<PersonDetailResponse>();
        tenant.MapPatch("/me/profile", UpdateMyProfileAsync).RequirePermission(Permissions.OrganizationView).WithName("updateMyProfile").Produces<PersonDetailResponse>();
        tenant.MapPost("/me/consents", RecordMyConsentAsync).RequirePermission(Permissions.OrganizationView).WithName("recordMyConsent").Produces<ConsentResponse>(StatusCodes.Status201Created);

        tenant.MapGet("/people/{personId:guid}/consents", HistoryAsync).RequirePermission(Permissions.PeopleView).WithName("listConsentHistory").Produces<ConsentListResponse>();
        tenant.MapPost("/people/{personId:guid}/consents", RecordOnBehalfAsync).RequirePermission(Permissions.ConsentManage).WithName("recordConsentOnBehalf").Produces<ConsentResponse>(StatusCodes.Status201Created);
        tenant.MapPost("/people/{personId:guid}/relationships", AddRelationshipAsync).RequirePermission(Permissions.PeopleManage).WithName("addRelationship").Produces<RelationshipResponse>(StatusCodes.Status201Created);
        tenant.MapDelete("/people/{personId:guid}/relationships/{relationshipId:guid}", DeleteRelationshipAsync).RequirePermission(Permissions.PeopleManage).WithName("deleteRelationship").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> GetMyProfileAsync(HttpContext httpContext, IConsentService consents) =>
        Results.Ok(PeopleEndpoints.ToResponse(await consents.GetMyProfileAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateMyProfileAsync(
        HttpContext httpContext,
        [FromBody] JsonElement body,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IConsentService consents)
    {
        var changes = PeopleEndpoints.ReadChanges(body);
        if (changes.Status is not null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "status.not_allowed", "Your own record cannot be archived here.", "status");
        }

        var updated = await consents.UpdateMyProfileAsync(
            TenantRouteFilter.Current(httpContext),
            new ProfileChanges(changes.DisplayName, changes.GivenName, changes.FamilyName, changes.BirthDate),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(PeopleEndpoints.ToResponse(updated));
    }

    private static async Task<IResult> RecordMyConsentAsync(HttpContext httpContext, RecordConsentRequest request, IConsentService consents)
    {
        var recorded = await consents.RecordMyConsentAsync(TenantRouteFilter.Current(httpContext), Choice(request), httpContext.RequestAborted);
        return Results.Created((string?)null, PeopleEndpoints.ToResponse(recorded));
    }

    private static async Task<IResult> HistoryAsync(HttpContext httpContext, Guid personId, IConsentService consents)
    {
        var history = await consents.HistoryAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted);
        return Results.Ok(new ConsentListResponse([.. history.Select(PeopleEndpoints.ToResponse)]));
    }

    private static async Task<IResult> RecordOnBehalfAsync(HttpContext httpContext, Guid personId, RecordConsentRequest request, IConsentService consents)
    {
        var recorded = await consents.RecordOnBehalfAsync(TenantRouteFilter.Current(httpContext), personId, Choice(request), httpContext.RequestAborted);
        return Results.Created((string?)null, PeopleEndpoints.ToResponse(recorded));
    }

    private static async Task<IResult> AddRelationshipAsync(HttpContext httpContext, Guid personId, CreateRelationshipRequest request, IConsentService consents)
    {
        var added = await consents.AddRelationshipAsync(TenantRouteFilter.Current(httpContext), personId, request.Type, request.ToPersonId, httpContext.RequestAborted);
        return Results.Created((string?)null, new RelationshipResponse(added.Id, added.Type, added.FromPersonId, added.ToPersonId, added.OtherDisplayName, added.CreatedAt));
    }

    private static async Task<IResult> DeleteRelationshipAsync(HttpContext httpContext, Guid personId, Guid relationshipId, IConsentService consents)
    {
        await consents.DeleteRelationshipAsync(TenantRouteFilter.Current(httpContext), personId, relationshipId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static ConsentChoice Choice(RecordConsentRequest request) =>
        new(request.Purpose, request.Channel, request.State, request.TextVersion);
}
