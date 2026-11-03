using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing.Patterns;
using Tempo.Api.ErrorHandling;

namespace Tempo.Api.Tenancy;

/// <summary>
/// The public routes answer only at their own spelling (#560, SR-8). API Gateway matches route keys case by case, but
/// ASP.NET routes ignore case, so `/api/v1/PUBLIC/studios/x` would miss the gateway's lower public throttles, fall
/// through to `{proxy+}` and still be served here. Every literal segment of the matched route must be as written (all
/// lower case); parameter values (a slug, a link code) are not touched. Anything else is 404 before any work.
/// The check reads the path as it was sent (the raw target), not the decoded one, so `/api/v1/%70ublic/...` is refused
/// too; and a trailing slash, which the gateway would also send to `{proxy+}`, is refused.
/// </summary>
public sealed class CanonicalPathFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;
        if (httpContext.GetEndpoint() is RouteEndpoint endpoint && !IsCanonical(endpoint.RoutePattern, SentPath(httpContext)))
        {
            return Problems.Result(httpContext, StatusCodes.Status404NotFound, "route.not_found", "There is no such address.");
        }

        return await next(context);
    }

    /// <summary>The path before any decoding: the raw target without its query, or the decoded path if the host gives none.</summary>
    public static string SentPath(HttpContext httpContext)
    {
        var raw = httpContext.Features.Get<IHttpRequestFeature>()?.RawTarget;
        if (string.IsNullOrEmpty(raw) || raw[0] != '/')
        {
            return httpContext.Request.Path.Value ?? string.Empty;
        }

        var query = raw.IndexOf('?', StringComparison.Ordinal);
        return query < 0 ? raw : raw[..query];
    }

    public static bool IsCanonical(RoutePattern pattern, string path)
    {
        var segments = (path.StartsWith('/') ? path[1..] : path).Split('/');
        if (segments.Length != pattern.PathSegments.Count)
        {
            return false;
        }

        for (var i = 0; i < segments.Length; i++)
        {
            var parts = pattern.PathSegments[i].Parts;
            if (parts.All(part => part.IsLiteral)
                && !string.Equals(string.Concat(parts.Cast<RoutePatternLiteralPart>().Select(p => p.Content)), segments[i], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }
}
