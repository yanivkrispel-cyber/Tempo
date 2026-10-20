using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Tempo.Api.DependencyInjection;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// Layer 1 rules that need no package (ADR-0025): every endpoint states who may
/// call it, and the backend projects only reference downwards. Tenant routes
/// naming a permission are covered in <see cref="PermissionTests"/>.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class ArchitectureTests
{
    /// <summary>Routes anyone may call. Adding one here is a security decision; say why in the PR.</summary>
    private static readonly string[] PublicRoutes =
    [
        "/api/v1/health",
        "/openapi/{documentName}.json",
        // A studio's installable app (docs/35 W-6): its manifest and icons carry its name, brand and slug, no person.
        "/api/v1/public/studios/{slug}/manifest.webmanifest",
        // The public page of docs/37 (MK2): the studio's face and its sessions as buckets, no person (M-10, M-14).
        "/api/v1/public/studios/{slug}/",
        "/api/v1/public/studios/{slug}/sessions",
        "/api/v1/public/studios/{slug}/sessions/{sessionId:guid}",
        "/api/v1/public/studios/{slug}/icons/{size}",
        // Share links by intent (SK4): where a link leads and an inviter's first name under SL-8; preview pictures
        // as redirects to the studio's own pictures. No other person data.
        "/api/v1/public/studios/{slug}/links/{code}",
        "/api/v1/public/studios/{slug}/cover",
        "/api/v1/public/studios/{slug}/sessions/{sessionId:guid}/cover",
        // The prices and offers of SL-4 and SL-5 (SK2): products the owner listed, their prices shown only, no person.
        "/api/v1/public/studios/{slug}/products",
        "/api/v1/public/studios/{slug}/products/{productId:guid}"
    ];

    [Fact]
    public void EveryEndpoint_DeclaresAuthorizationOrIsExplicitlyPublic()
    {
        foreach (var endpoint in Endpoints())
        {
            var route = Route(endpoint);
            if (endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            {
                PublicRoutes.Should().Contain(route, $"{endpoint.DisplayName} allows anonymous callers");
                continue;
            }

            endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Should()
                .NotBeEmpty($"{endpoint.DisplayName} must be mapped on a route group or marked AllowAnonymous");
        }
    }

    [Fact]
    public void PublicRoutes_AreMarkedAllowAnonymous()
    {
        var anonymous = Endpoints()
            .Where(e => e.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            .Select(Route);

        anonymous.Should().BeEquivalentTo(PublicRoutes);
    }

    [Fact]
    public void PlatformRoutes_RequireTheOperatorPolicy()
    {
        var platform = Endpoints().Where(e => Route(e).StartsWith("/api/v1/platform/", StringComparison.Ordinal)).ToList();

        platform.Should().NotBeEmpty();
        foreach (var endpoint in platform)
        {
            endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>()
                .Select(a => a.Policy)
                .Should().Contain(CognitoAuthentication.OperatorPolicy, $"{endpoint.DisplayName} is a platform route");
        }
    }

    [Theory]
    [InlineData("Tempo.Contracts")]
    [InlineData("Tempo.Platform", "Tempo.Contracts")]
    [InlineData("Tempo.Api", "Tempo.Contracts", "Tempo.Platform")]
    [InlineData("Tempo.Worker", "Tempo.Contracts", "Tempo.Platform")]
    public void BackendAssemblies_ReferenceOnlyTheLayersBelow(string assembly, params string[] allowed)
    {
        var references = Assembly.Load(assembly).GetReferencedAssemblies()
            .Select(a => a.Name!)
            .Where(name => name.StartsWith("Tempo.", StringComparison.Ordinal));

        references.Should().BeSubsetOf(allowed, $"{assembly} must not depend on the API, the worker or the migrator");
    }

    private static List<RouteEndpoint> Endpoints()
    {
        using var api = new TestApi();
        return api.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .ToList();
    }

    private static string Route(RouteEndpoint endpoint) => "/" + endpoint.RoutePattern.RawText?.TrimStart('/');
}
