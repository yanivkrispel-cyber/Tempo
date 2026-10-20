using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Tempo.Api.Tenancy;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// Whose address a per-address limit counts (#419 review): API Gateway's source IP on the HTTP API; on the edge's
/// Function URL, which accepts only CloudFront's signed calls, the viewer address CloudFront sets.
/// </summary>
public sealed class ClientAddressTests
{
    [Fact]
    public void OnTheHttpApi_ItIsTheSourceIp_AndAViewerHeaderIsIgnored()
    {
        var context = Request("2a5q3fao7a.execute-api.eu-central-1.amazonaws.com", "198.51.100.7", "203.0.113.9:443");

        ClientAddress.Of(context).Should().Be("198.51.100.7", "a caller can set any header on the HTTP API");
    }

    [Theory]
    [InlineData("203.0.113.9:443", "203.0.113.9")]
    [InlineData("2001:db8::1:51000", "2001:db8::1")]
    public void OnTheFunctionUrl_ItIsTheViewerAddressCloudFrontSet(string header, string expected)
    {
        var context = Request("abc123.lambda-url.eu-central-1.on.aws", "130.176.1.1", header);

        ClientAddress.Of(context).Should().Be(expected);
    }

    [Fact]
    public void OnTheFunctionUrl_WithoutTheHeader_ThereIsNoAddressToCount()
    {
        ClientAddress.Of(Request("abc123.lambda-url.eu-central-1.on.aws", "130.176.1.1", null)).Should().BeNull("an edge address would make everyone one client");
    }

    private static DefaultHttpContext Request(string host, string source, string? viewer)
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString(host);
        context.Connection.RemoteIpAddress = IPAddress.Parse(source);
        if (viewer is not null)
        {
            context.Request.Headers["CloudFront-Viewer-Address"] = viewer;
        }

        return context;
    }
}
