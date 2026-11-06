using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// SR-18: authorization fails closed. An endpoint that declares nothing needs a
/// customer token; a public route says so with AllowAnonymous.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class FallbackPolicyTests : IDisposable
{
    private readonly TestApi api = new(endpoints =>
    {
        endpoints.MapGet("/api/v1/undeclared-probe", () => "undeclared");
        endpoints.MapGet("/api/v1/public-probe", () => "public").AllowAnonymous();
    });

    [Fact]
    public async Task AnEndpointThatDeclaresNothing_WithoutAToken_Returns401()
    {
        var response = await api.GetAsync("/api/v1/undeclared-probe", null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AnEndpointThatDeclaresNothing_WithACustomerToken_Returns200()
    {
        var response = await api.GetAsync("/api/v1/undeclared-probe", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AnEndpointThatDeclaresNothing_WithAnOperatorToken_Returns401()
    {
        var response = await api.GetAsync("/api/v1/undeclared-probe", api.OperatorToken());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AnAllowAnonymousRoute_StaysOpen()
    {
        var response = await api.GetAsync("/api/v1/public-probe", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task TheHealthRoute_StaysOpen()
    {
        var response = await api.GetAsync("/api/v1/health", null);

        response.StatusCode.Should().NotBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AnUnknownPath_WithoutAToken_Returns401NotARouteMap()
    {
        var response = await api.GetAsync("/api/v1/no-such-route", null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    public void Dispose() => api.Dispose();
}
