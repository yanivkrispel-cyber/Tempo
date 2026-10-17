using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The studio's tags and staff notes on a person (docs/34 sections 7, 8 and 12). The service holds the rules; these
/// handlers translate HTTP. Deleting a note needs `people.notes.view` here and, in the service, `people.notes.manage`
/// for your own note or `people.notes.moderate` for anyone's.
/// </summary>
public static class TagsAndNotesEndpoints
{
    public static IEndpointRouteBuilder MapTagsAndNotesEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/tags", ListTagsAsync).RequirePermission(Permissions.PeopleView).WithName("listTags").Produces<TagListResponse>();
        tenant.MapPost("/tags", CreateTagAsync).RequirePermission(Permissions.PeopleTagsManage).WithName("createTag").Produces<TagResponse>(StatusCodes.Status201Created);
        tenant.MapPatch("/tags/{tagId:guid}", UpdateTagAsync).RequirePermission(Permissions.PeopleTagsManage).WithName("updateTag").Produces<TagResponse>();
        tenant.MapDelete("/tags/{tagId:guid}", DeleteTagAsync).RequirePermission(Permissions.PeopleTagsManage).WithName("deleteTag").Produces(StatusCodes.Status204NoContent);
        tenant.MapPost("/people/{personId:guid}/tags/{tagId:guid}", TagPersonAsync).RequirePermission(Permissions.PeopleManage).WithName("tagPerson").Produces<PersonTagListResponse>();
        tenant.MapDelete("/people/{personId:guid}/tags/{tagId:guid}", UntagPersonAsync).RequirePermission(Permissions.PeopleManage).WithName("untagPerson").Produces<PersonTagListResponse>();
        tenant.MapGet("/people/{personId:guid}/notes", ListNotesAsync).RequirePermission(Permissions.PeopleNotesView).WithName("listPersonNotes").Produces<PersonNotePageResponse>();
        tenant.MapPost("/people/{personId:guid}/notes", AddNoteAsync).RequirePermission(Permissions.PeopleNotesManage).WithName("addPersonNote").Produces<PersonNoteResponse>(StatusCodes.Status201Created);
        tenant.MapDelete("/people/{personId:guid}/notes/{noteId:guid}", DeleteNoteAsync).RequirePermission(Permissions.PeopleNotesView).WithName("deletePersonNote").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> ListTagsAsync(HttpContext httpContext, IPeopleTagsAndNotesService service) =>
        Results.Ok(new TagListResponse([.. (await service.ListTagsAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> CreateTagAsync(HttpContext httpContext, CreateTagRequest request, IPeopleTagsAndNotesService service)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var tag = await service.CreateTagAsync(tenant, request.Name, request.Color, httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/tags/{tag.Id}", ToResponse(tag));
    }

    private static async Task<IResult> UpdateTagAsync(
        HttpContext httpContext,
        Guid tagId,
        UpdateTagRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IPeopleTagsAndNotesService service) =>
        Results.Ok(ToResponse(await service.UpdateTagAsync(
            TenantRouteFilter.Current(httpContext), tagId, request.Name, request.Color, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted)));

    private static async Task<IResult> DeleteTagAsync(HttpContext httpContext, Guid tagId, IPeopleTagsAndNotesService service)
    {
        await service.DeleteTagAsync(TenantRouteFilter.Current(httpContext), tagId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> TagPersonAsync(HttpContext httpContext, Guid personId, Guid tagId, IPeopleTagsAndNotesService service) =>
        Results.Ok(ToResponse(await service.TagPersonAsync(TenantRouteFilter.Current(httpContext), personId, tagId, httpContext.RequestAborted)));

    private static async Task<IResult> UntagPersonAsync(HttpContext httpContext, Guid personId, Guid tagId, IPeopleTagsAndNotesService service) =>
        Results.Ok(ToResponse(await service.UntagPersonAsync(TenantRouteFilter.Current(httpContext), personId, tagId, httpContext.RequestAborted)));

    private static async Task<IResult> ListNotesAsync(HttpContext httpContext, Guid personId, Guid? before, int? limit, IPeopleTagsAndNotesService service)
    {
        var page = await service.ListNotesAsync(TenantRouteFilter.Current(httpContext), personId, before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(new PersonNotePageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> AddNoteAsync(HttpContext httpContext, Guid personId, CreatePersonNoteRequest request, IPeopleTagsAndNotesService service)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var note = await service.AddNoteAsync(tenant, personId, request.Body, httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/people/{personId}/notes/{note.Id}", ToResponse(note));
    }

    private static async Task<IResult> DeleteNoteAsync(HttpContext httpContext, Guid personId, Guid noteId, IPeopleTagsAndNotesService service)
    {
        await service.DeleteNoteAsync(TenantRouteFilter.Current(httpContext), personId, noteId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static TagResponse ToResponse(TagView t) =>
        new(t.Id, t.Name, t.Color, t.PeopleCount, t.CreatedAt, t.Version.ToString(CultureInfo.InvariantCulture));

    private static PersonTagListResponse ToResponse(IReadOnlyList<PersonTagView> tags) =>
        new([.. tags.Select(t => new PersonTagResponse(t.Id, t.Name, t.Color))]);

    private static PersonNoteResponse ToResponse(PersonNoteView n) =>
        new(n.Id, n.Body, n.CreatedAt, n.AuthorMembershipId, n.AuthorName, n.AuthorRole, n.Mine);
}
