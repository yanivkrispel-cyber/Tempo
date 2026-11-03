using FluentAssertions;
using Microsoft.AspNetCore.Routing.Patterns;
using Tempo.Api.Tenancy;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>#560 SR-8: a public route is served only at its own spelling; parameter values keep whatever case they have.</summary>
public sealed class CanonicalPathFilterTests
{
    private static readonly RoutePattern Link = RoutePatternFactory.Parse("/api/v1/public/studios/{slug}/links/{code}");
    private static readonly RoutePattern Manifest = RoutePatternFactory.Parse("/api/v1/public/studios/{slug}/manifest.webmanifest");

    [Theory]
    [InlineData("/api/v1/public/studios/neshima/links/AbC-12_x", true)]
    [InlineData("/api/v1/public/studios/neshima/links/AbC-12_x/", true)]
    [InlineData("/api/v1/public/studios/NESHIMA/links/abc", true)]
    [InlineData("/api/v1/PUBLIC/studios/neshima/links/abc", false)]
    [InlineData("/Api/v1/public/studios/neshima/links/abc", false)]
    [InlineData("/api/v1/public/studios/neshima/Links/abc", false)]
    public void OnlyTheLiteralSegments_MustBeAsWritten(string path, bool canonical) =>
        CanonicalPathFilter.IsCanonical(Link, path).Should().Be(canonical);

    [Fact]
    public void ALiteralWithADot_IsComparedWhole() =>
        (CanonicalPathFilter.IsCanonical(Manifest, "/api/v1/public/studios/x/manifest.webmanifest"),
         CanonicalPathFilter.IsCanonical(Manifest, "/api/v1/public/studios/x/Manifest.webmanifest"))
            .Should().Be((true, false));
}
