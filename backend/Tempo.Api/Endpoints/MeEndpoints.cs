using Tempo.Api.Middleware;
using Tempo.Contracts.Api.Common;

namespace Tempo.Api.Endpoints;

/// <summary>
/// GET /api/v1/me - requires a Cognito access token, validated by the API
/// itself (DependencyInjection/CognitoAuthentication.cs, ADR-0004 amendment).
/// The API Gateway JWT authorizer still runs in front of it until the
/// CloudFront ingress replaces API Gateway; the API no longer depends on it.
///
/// This reflects the raw JWT identity only (sub/email). It is not the
/// internal user/organization-membership model - that model, and the
/// business authorization built on top of it, belong to the future
/// Identity/Membership LLD (docs/01_AWS_Infrastructure_LLD.md section 41).
/// </summary>
public static class MeEndpoints
{
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/me", (HttpContext httpContext) =>
            {
                var correlationId = httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier;
                var user = httpContext.User;

                var subject = user.FindFirst("sub")?.Value;
                if (string.IsNullOrEmpty(subject))
                {
                    return Results.Problem(
                        statusCode: StatusCodes.Status401Unauthorized,
                        title: "Unauthorized",
                        type: "https://tempo.dev/problems/unauthorized",
                        extensions: new Dictionary<string, object?> { ["correlationId"] = correlationId });
                }

                var email = user.FindFirst("email")?.Value;
                var emailVerified = bool.TryParse(user.FindFirst("email_verified")?.Value, out var verified) && verified;

                return Results.Ok(new MeResponse(subject, email, emailVerified, correlationId));
            })
            .RequireAuthorization()
            .WithName("GetMe")
            .Produces<MeResponse>()
            .Produces(StatusCodes.Status401Unauthorized);

        return endpoints;
    }
}
