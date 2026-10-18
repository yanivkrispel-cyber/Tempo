using SkiaSharp;

namespace Tempo.Platform.Modules.Media;

/// <summary>One processed picture: WebP at two sizes, no metadata (docs/33 X-7).</summary>
public sealed record ProcessedImage(byte[] Large, byte[] Small, int Width, int Height);

/// <summary>
/// Decodes an uploaded picture and writes it again as WebP. Re-encoding drops every byte the original carried
/// besides pixels (EXIF, location, comments, anything appended), which is why it replaces a malware scan for
/// images (D17). Only JPEG, PNG and WebP are accepted, by their magic bytes, not by the declared type.
/// </summary>
public static class ImageProcessor
{
    public const int LargeSide = 1600;
    public const int SmallSide = 400;
    // The bitmap is held up to three times (decode, orient, resize) in a 512 MB Lambda; 12 MP is about 48 MB a copy.
    private const long MaxPixels = 12_000_000;
    private const int Quality = 82;

    public static ProcessedImage? Process(byte[] bytes)
    {
        if (!LooksLikeImage(bytes))
        {
            return null;
        }

        using var codec = SKCodec.Create(new SKMemoryStream(bytes));
        if (codec is null || (long)codec.Info.Width * codec.Info.Height > MaxPixels || codec.Info.Width < 16 || codec.Info.Height < 16)
        {
            return null;
        }

        using var decoded = SKBitmap.Decode(codec);
        if (decoded is null)
        {
            return null;
        }

        // Phone photos carry their rotation in EXIF; apply it before the metadata is dropped.
        using var upright = Orient(decoded, codec.EncodedOrigin);
        var large = Encode(upright, LargeSide, out var width, out var height);
        var small = Encode(upright, SmallSide, out _, out _);
        return large is null || small is null ? null : new ProcessedImage(large, small, width, height);
    }

    private static bool LooksLikeImage(byte[] b) =>
        b.Length > 12 && (
            (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) ||                                            // JPEG
            (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) ||                            // PNG
            (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50)); // RIFF....WEBP

    private static byte[]? Encode(SKBitmap source, int longSide, out int width, out int height)
    {
        var scale = Math.Min(1.0, (double)longSide / Math.Max(source.Width, source.Height));
        width = Math.Max(1, (int)Math.Round(source.Width * scale));
        height = Math.Max(1, (int)Math.Round(source.Height * scale));
        using var resized = source.Resize(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul), new SKSamplingOptions(SKCubicResampler.Mitchell));
        if (resized is null)
        {
            return null;
        }

        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(SKEncodedImageFormat.Webp, Quality);
        return data?.ToArray();
    }

    private static SKBitmap Orient(SKBitmap bitmap, SKEncodedOrigin origin)
    {
        if (origin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default)
        {
            return bitmap.Copy();
        }

        var rotated = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var result = new SKBitmap(rotated ? bitmap.Height : bitmap.Width, rotated ? bitmap.Width : bitmap.Height);
        using var canvas = new SKCanvas(result);
        canvas.Translate(result.Width / 2f, result.Height / 2f);
        switch (origin)
        {
            case SKEncodedOrigin.BottomRight:
                canvas.RotateDegrees(180);
                break;
            case SKEncodedOrigin.RightTop:
                canvas.RotateDegrees(90);
                break;
            case SKEncodedOrigin.LeftBottom:
                canvas.RotateDegrees(270);
                break;
            case SKEncodedOrigin.TopRight:
                canvas.Scale(-1, 1);
                break;
            case SKEncodedOrigin.BottomLeft:
                canvas.Scale(1, -1);
                break;
            case SKEncodedOrigin.LeftTop:
                canvas.RotateDegrees(90);
                canvas.Scale(1, -1);
                break;
            case SKEncodedOrigin.RightBottom:
                canvas.RotateDegrees(270);
                canvas.Scale(1, -1);
                break;
        }

        canvas.Translate(-bitmap.Width / 2f, -bitmap.Height / 2f);
        using var image = SKImage.FromBitmap(bitmap);
        canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Linear));
        return result;
    }
}
