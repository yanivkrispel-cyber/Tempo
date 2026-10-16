using Tempo.Api.Middleware;
using Tempo.Contracts.Api.Common;

namespace Tempo.Api.Endpoints;

/// <summary>GET /api/v1/health - public, unauthenticated, no downstream dependency calls.</summary>
public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/health", (HttpContext httpContext) =>
            {
                var correlationId = httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier;

                var response = new HealthResponse(
                    Status: "healthy",
                    Environment: Environment.GetEnvironmentVariable("TEMPO_ENVIRONMENT") ?? "unknown",
                    Version: Environment.GetEnvironmentVariable("BUILD_VERSION") ?? "local",
                    Timestamp: DateTimeOffset.UtcNow,
                    CorrelationId: correlationId);

                return Results.Ok(response);
            })
            .AllowAnonymous()
            .WithName("getHealth")
            .Produces<HealthResponse>();

        return endpoints;
    }
}
