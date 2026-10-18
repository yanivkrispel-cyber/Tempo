using System.Text;
using System.Text.Json;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using FluentAssertions;
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.UnitTests.Media;

/// <summary>
/// The presigned POST (#345, H-1): S3 itself refuses a file over the limit, another content type, or another key,
/// because the signed policy says so. Signing is local; no request reaches AWS.
/// </summary>
public sealed class S3MediaStoreTests
{
    private const string Bucket = "tempo-dev-media-000000000000";

    private static S3MediaStore Store() =>
        new(new AmazonS3Client(new BasicAWSCredentials("AKIDEXAMPLE", "not-a-real-secret"), RegionEndpoint.EUCentral1), Bucket);

    [Fact]
    public void PresignPost_SignsAPolicy_ThatCapsTheSize_AndPinsTheKeyAndContentType()
    {
        var form = Store().PresignPost("incoming/0199f1c2-0000-7000-8000-000000000001", "image/png", MediaService.MaxUploadBytes, TimeSpan.FromMinutes(10));

        form.Url.Host.Should().Contain(Bucket);
        form.Url.Scheme.Should().Be("https");
        form.Fields.Should().Contain("key", "incoming/0199f1c2-0000-7000-8000-000000000001");
        form.Fields.Should().Contain("Content-Type", "image/png");
        form.Fields.Keys.Should().Contain(["Policy", "x-amz-signature", "x-amz-credential", "x-amz-algorithm", "x-amz-date"]);

        using var policy = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(form.Fields["Policy"])));
        var conditions = policy.RootElement.GetProperty("conditions").EnumerateArray().Select(c => c.GetRawText()).ToList();
        conditions.Should().Contain("[\"content-length-range\",1,8388608]");
        conditions.Should().Contain(c => c.Contains("\"Content-Type\"") && c.Contains("\"image/png\""));
        conditions.Should().Contain(c => c.Contains("\"key\"") && c.Contains("incoming/0199f1c2-0000-7000-8000-000000000001"));
        conditions.Should().Contain(c => c.Contains("\"bucket\"") && c.Contains(Bucket));

        var expires = policy.RootElement.GetProperty("expiration").GetDateTimeOffset();
        expires.Should().BeCloseTo(DateTimeOffset.UtcNow.AddMinutes(10), TimeSpan.FromMinutes(1));
    }
}
