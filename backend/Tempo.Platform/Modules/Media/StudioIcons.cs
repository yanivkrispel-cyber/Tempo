using SkiaSharp;

namespace Tempo.Platform.Modules.Media;

/// <summary>One PNG a phone installs: its name in the object key, its side and whether it is the maskable one.</summary>
public sealed record StudioIconSize(string Name, int Side, bool Maskable);

/// <summary>
/// The studio's home-screen icons (docs/35 sections 2 and 5, WL1): the mark centred on a solid ground, as PNG at the
/// sizes a manifest and iOS ask for. A plain icon holds the mark in 72% of its side; the maskable one keeps the mark
/// inside the safe circle (80% of the side), so a square mark gets 56%. The ground fills every pixel: launchers and
/// iOS draw their own corners, and a transparent corner would show black on some.
/// </summary>
public static class StudioIcons
{
    public const int MinimumSide = 512;

    public static readonly IReadOnlyList<StudioIconSize> Sizes =
    [
        new("192", 192, false),
        new("512", 512, false),
        new("512-maskable", 512, true),
        new("180", 180, false)
    ];

    private const float PlainBox = 0.72f;
    private const float MaskableBox = 0.56f;

    /// <summary>Every size of the icon from a processed picture (the re-encoded WebP); null when it can't be decoded.</summary>
    public static IReadOnlyDictionary<string, byte[]>? Render(byte[] picture, string groundHex)
    {
        using var mark = SKBitmap.Decode(picture);
        if (mark is null)
        {
            return null;
        }

        var ground = SKColor.Parse(groundHex);
        return Sizes.ToDictionary(size => size.Name, size => Draw(size, ground, canvas =>
        {
            var box = size.Side * (size.Maskable ? MaskableBox : PlainBox);
            var scale = Math.Min(box / mark.Width, box / mark.Height);
            var width = mark.Width * scale;
            var height = mark.Height * scale;
            var target = SKRect.Create((size.Side - width) / 2, (size.Side - height) / 2, width, height);
            using var image = SKImage.FromBitmap(mark);
            canvas.DrawImage(image, target, new SKSamplingOptions(SKCubicResampler.Mitchell));
        }));
    }

    private static byte[] Draw(StudioIconSize size, SKColor ground, Action<SKCanvas> drawMark)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(size.Side, size.Side, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(ground);
            drawMark(canvas);
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
