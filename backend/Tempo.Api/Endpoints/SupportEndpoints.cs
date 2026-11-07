using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Support;
using Tempo.Platform.Modules.Support;

namespace Tempo.Api.Endpoints;

/// <summary>The console's "עזרה ויצירת קשר" (board #584, PL-4): how studio staff reach the Tempo team.</summary>
public static class SupportEndpoints
{
    public static IEndpointRouteBuilder MapSupportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapAccountGroup().MapGet("/support-contact", GetAsync).WithName("getSupportContact").Produces<SupportContactResponse>();
        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, SupportContactSource source) =>
        Results.Ok(await source.GetAsync(httpContext.RequestAborted) is { } contact
            ? new SupportContactResponse(contact.Contact, contact.Kind)
            : new SupportContactResponse(null, null));
}
