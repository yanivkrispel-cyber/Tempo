using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Tempo.Api.Middleware;
using Tempo.Contracts.Api.Common;
using Xunit;

namespace Tempo.UnitTests.Api;

[Collection(ApiHostGroup.Name)]
public sealed class HealthEndpointTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_ReturnsOkWithExpectedContract()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/json");

        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();

        body.Should().NotBeNull();
        body.Status.Should().Be("healthy");
        body.Timestamp.Should().BeCloseTo(DateTimeOffset.UtcNow, TimeSpan.FromMinutes(1));
        body.Version.Should().NotBeNullOrWhiteSpace();
        body.Environment.Should().NotBeNullOrWhiteSpace();
        body.CorrelationId.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Health_EchoesCorrelationIdHeader_WhenProvided()
    {
        var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add(CorrelationIdMiddleware.HeaderName, "test-correlation-id");

        var response = await client.SendAsync(request);

        response.Headers.GetValues(CorrelationIdMiddleware.HeaderName).Should().Contain("test-correlation-id");
    }

    [Theory]
    [InlineData("has spaces and <tags>")]
    [InlineData("a_b")]
    [InlineData("0123456789012345678901234567890123456789012345678901234567890123456789")]
    public async Task Health_ReplacesACorrelationId_ThatIsNotShortAndPlain(string sent)
    {
        var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.TryAddWithoutValidation(CorrelationIdMiddleware.HeaderName, sent);

        var response = await client.SendAsync(request);

        var echoed = response.Headers.GetValues(CorrelationIdMiddleware.HeaderName).Single();
        echoed.Should().NotBe(sent).And.MatchRegex("^[a-f0-9]{32}$", "a generated id takes its place (#124)");
    }

    [Fact]
    public async Task Health_GeneratesCorrelationId_WhenNotProvided()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/health");

        response.Headers.Contains(CorrelationIdMiddleware.HeaderName).Should().BeTrue();
    }

    [Fact]
    public async Task Health_DoesNotExposeSensitiveConfiguration()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/health");
        var raw = await response.Content.ReadAsStringAsync();

        raw.ToLowerInvariant().Should().NotContainAny("password", "secret", "connectionstring", "arn:aws");
    }

    [Fact]
    public async Task Health_DoesNotRequireAuthentication()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/health");

        response.StatusCode.Should().NotBe(HttpStatusCode.Unauthorized);
        response.StatusCode.Should().NotBe(HttpStatusCode.Forbidden);
    }
}
