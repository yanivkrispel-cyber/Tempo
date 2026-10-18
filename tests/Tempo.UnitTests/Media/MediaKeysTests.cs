using FluentAssertions;
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.UnitTests.Media;

/// <summary>
/// Object keys (#345, H-3): a picture created from <see cref="MediaKeys.StudioPrefixSince"/> on lives under its
/// studio's id; one created before keeps the key it was written with, so every existing picture still resolves.
/// The media id is a UUIDv7, which carries its creation time.
/// </summary>
public sealed class MediaKeysTests
{
    private static readonly Guid Studio = Guid.Parse("0199f000-0000-7000-8000-00000000abcd");

    [Fact]
    public void ANewPicture_LivesUnderItsStudio()
    {
        var id = Guid.CreateVersion7(MediaKeys.StudioPrefixSince.AddSeconds(1));

        MediaKeys.Incoming(Studio, id).Should().Be($"incoming/{Studio:D}/{id:D}");
        MediaKeys.Large(Studio, id).Should().Be($"media/{Studio:D}/{id:D}/large.webp");
        MediaKeys.Small(Studio, id).Should().Be($"media/{Studio:D}/{id:D}/small.webp");
    }

    [Fact]
    public void AnOlderPicture_KeepsTheKeyItWasWrittenWith()
    {
        var id = Guid.CreateVersion7(MediaKeys.StudioPrefixSince.AddMilliseconds(-1));

        MediaKeys.Incoming(Studio, id).Should().Be($"incoming/{id:D}");
        MediaKeys.Large(Studio, id).Should().Be($"media/{id:D}/large.webp");
        MediaKeys.Small(Studio, id).Should().Be($"media/{id:D}/small.webp");
    }

    [Fact]
    public void AnIdThatIsNotAVersion7_IsReadAsOld()
    {
        var id = Guid.Parse("ffffffff-ffff-4fff-bfff-ffffffffffff");

        MediaKeys.Large(Studio, id).Should().Be($"media/{id:D}/large.webp");
    }
}
