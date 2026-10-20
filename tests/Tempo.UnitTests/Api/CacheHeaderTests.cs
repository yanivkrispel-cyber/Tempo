using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// K5 (board #404): an API answer that doesn't say how it may be cached is `private, no-store`, so a browser or a
/// proxy never keeps a person's data; the public routes set their own `public` caching (PublicStudioFlowTests).
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class CacheHeaderTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Theory]
    [InlineData("/api/v1/health")]
    [InlineData("/api/v1/me")]
    [InlineData("/api/v1/organizations/0198f0d4-0000-7000-8000-000000000000/people")]
    public async Task AnAnswerWithoutItsOwnCaching_IsPrivateAndNotStored(string path)
    {
        var response = await factory.CreateClient().GetAsync(path);

        response.Headers.CacheControl.Should().NotBeNull();
        response.Headers.CacheControl.NoStore.Should().BeTrue();
        response.Headers.CacheControl.Private.Should().BeTrue();
        response.Headers.CacheControl.Public.Should().BeFalse();
    }
}
