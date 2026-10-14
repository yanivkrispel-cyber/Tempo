using Tempo.Api.DependencyInjection;

namespace Tempo.Api.Tenancy;

/// <summary>
/// The three kinds of authenticated routes (docs/26 section 8). Endpoints are
/// mapped onto one of these groups, never directly, so the scheme and the
/// tenant filter cannot be forgotten.
/// </summary>
public static class RouteGroups
{
    /// <summary>`/api/v1/...` with a customer token and no tenant: session, me, creating a studio, joining.</summary>
    public static RouteGroupBuilder MapAccountGroup(this IEndpointRouteBuilder endpoints) =>
        endpoints.MapGroup("/api/v1").RequireAuthorization();

    /// <summary>`/api/v1/organizations/{organizationId}/...` with a customer token and a resolved <c>TenantContext</c>.</summary>
    public static RouteGroupBuilder MapTenantGroup(this IEndpointRouteBuilder endpoints) =>
        endpoints.MapGroup($"/api/v1/organizations/{{{TenantRouteFilter.RouteValue}:guid}}")
            .RequireAuthorization()
            .AddEndpointFilter<TenantRouteFilter>();

    /// <summary>`/api/v1/platform/...` with an operator token only (ADR-0023).</summary>
    public static RouteGroupBuilder MapPlatformGroup(this IEndpointRouteBuilder endpoints) =>
        endpoints.MapGroup("/api/v1/platform").RequireAuthorization(CognitoAuthentication.OperatorPolicy);
}

/// <summary>
/// A set of endpoints a module adds to the API. Program.cs maps every
/// registered module, so a module plugs in through DI alone.
/// </summary>
public interface IEndpointModule
{
    void Map(IEndpointRouteBuilder endpoints);
}
