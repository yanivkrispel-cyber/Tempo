using Tempo.Api.ErrorHandling;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Api.Tenancy;

/// <summary>
/// Every `/api/v1/public/studios/{slug}/...` route: the slug must name an active studio, otherwise 404
/// `studio.not_found` (a suspended or removed studio included, docs/35 W-6). Builds the <see cref="PublicStudio"/>.
/// The one place that resolves a public slug, for WL4's manifest and icons and docs/37's public pages.
/// </summary>
public sealed class PublicStudioRouteFilter(IPublicStudioDirectory studios) : IEndpointFilter
{
    public const string RouteValue = "slug";
    private const string ItemKey = "Tempo.PublicStudio";

    public static PublicStudio Current(HttpContext httpContext) =>
        httpContext.Items[ItemKey] as PublicStudio
        ?? throw new InvalidOperationException("No public studio: the endpoint is not in the public studio route group.");

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;
        var slug = httpContext.GetRouteValue(RouteValue) as string ?? string.Empty;
        var studio = await studios.FindAsync(slug, httpContext.RequestAborted);
        if (studio is null)
        {
            // Not cached for long, so a studio that comes back is found again.
            httpContext.Response.Headers.CacheControl = "public, max-age=60";
            return Problems.Result(httpContext, StatusCodes.Status404NotFound, "studio.not_found", "There is no such studio.");
        }

        httpContext.Items[ItemKey] = studio;
        return await next(context);
    }
}
