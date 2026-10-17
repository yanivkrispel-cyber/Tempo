using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Media;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Pictures (docs/33 section 6): an upload ticket, the finalize step that re-encodes the file, and removing a
/// picture. Who may set which picture is checked by the service, by the picture's purpose and owner.
/// </summary>
public static class MediaEndpoints
{
    public static IEndpointRouteBuilder MapMediaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapPost("/media/uploads", StartAsync).RequirePermission(Permissions.ScheduleView).WithName("startMediaUpload").Produces<MediaUploadTicketResponse>(StatusCodes.Status201Created);
        tenant.MapPost("/media/uploads/{mediaId:guid}/finalize", FinalizeAsync).RequirePermission(Permissions.ScheduleView).WithName("finalizeMediaUpload").Produces<MediaResponse>();
        tenant.MapDelete("/media", RemoveAsync).RequirePermission(Permissions.ScheduleView).WithName("removeMedia").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> StartAsync(HttpContext httpContext, MediaUploadRequest request, IMediaService media)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var ticket = await media.StartUploadAsync(tenant, request.Purpose, request.OwnerId, request.ContentType, request.Bytes, httpContext.RequestAborted);
        return Results.Created(
            $"/api/v1/organizations/{tenant.OrganizationId}/media/uploads/{ticket.MediaId}",
            new MediaUploadTicketResponse(ticket.MediaId, ticket.UploadUrl, ticket.ContentType, ticket.ExpiresAt));
    }

    private static async Task<IResult> FinalizeAsync(HttpContext httpContext, Guid mediaId, IMediaService media)
    {
        var ready = await media.FinalizeAsync(TenantRouteFilter.Current(httpContext), mediaId, httpContext.RequestAborted);
        return Results.Ok(new MediaResponse(ready.Id, ready.Purpose, ready.OwnerId, MediaLinks.Url(ready.Id)!, MediaLinks.Url(ready.Id, small: true)!, ready.Width, ready.Height));
    }

    private static async Task<IResult> RemoveAsync(HttpContext httpContext, string? purpose, Guid? ownerId, IMediaService media)
    {
        await media.RemoveAsync(TenantRouteFilter.Current(httpContext), purpose, ownerId, httpContext.RequestAborted);
        return Results.NoContent();
    }
}

/// <summary>
/// Turns a picture id into a short-lived URL for a response; null when there is no picture or no bucket. The
/// store is the request's own (set by <see cref="UseMediaLinks"/>), so test hosts with different stores never mix.
/// </summary>
public static class MediaLinks
{
    private static readonly AsyncLocal<IMediaStore?> Current = new();
    private static readonly IMediaStore None = new UnavailableMediaStore();

    private static IMediaStore Store => Current.Value ?? None;

    /// <summary>Makes the request's picture store the one <see cref="Url"/> signs with.</summary>
    public static IApplicationBuilder UseMediaLinks(this IApplicationBuilder app) =>
        app.Use((context, next) =>
        {
            Current.Value = context.RequestServices.GetRequiredService<IMediaStore>();
            return next(context);
        });


    public static Uri? Url(Guid? mediaId, bool small = false)
    {
        if (mediaId is not { } id || !Store.Available)
        {
            return null;
        }

        var key = small ? MediaKeys.Small(id) : MediaKeys.Large(id);
        return Store.PresignGet(key, MediaKeys.UrlLifetime);
    }
}
