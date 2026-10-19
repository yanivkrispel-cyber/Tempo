using System.Text.Json;
using FluentAssertions;
using SkiaSharp;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.Modules.Media;
using Tempo.Platform.Modules.Organizations.Domain;
using Xunit;

namespace Tempo.UnitTests.Organizations;

/// <summary>
/// The brand's rules (docs/35 sections 2 and 3, WL1): the eight accents are the design system's, the app name fits
/// under an icon, and the icon PNGs are drawn on a solid ground with the mark inside the safe area.
/// </summary>
public sealed class BrandTests
{
    [Fact]
    public void TheAccents_AreTheDesignSystemsEight_WithTheirLightBrandValue()
    {
        using var tokens = JsonDocument.Parse(File.ReadAllText(RepoFile("packages", "design-system", "tokens", "tokens.json")));
        var accents = tokens.RootElement.GetProperty("accents");
        var expected = accents.GetProperty("list").EnumerateArray()
            .ToDictionary(a => a.GetProperty("id").GetString()!, a => a.GetProperty("value").GetProperty("light").GetProperty("brand").GetString()!);

        Brand.Accents.Should().Equal(expected);
        Brand.DefaultAccent.Should().Be(accents.GetProperty("default").GetString());
        var paper = tokens.RootElement.GetProperty("color").GetProperty("tokens").EnumerateArray().Single(t => t.GetProperty("name").GetString() == "paper");
        Brand.PaperHex.Should().Be(paper.GetProperty("value").GetProperty("light").GetString());
    }

    [Theory]
    [InlineData("סטודיו נשימה", "סטודיו נשימה")]
    [InlineData("  Flow  ", "Flow")]
    [InlineData("סטודיו נשימה ותנועה", "סטודיו")]
    [InlineData("Pilatesandmorestudio Tel Aviv", "Pilatesandmo")]
    public void TheDefaultAppName_IsTheDisplayName_OrItsFirstWord_CutAt12(string displayName, string expected) =>
        Brand.DefaultAppName(displayName).Should().Be(expected);

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("שלושה עשר תוו")]
    [InlineData("tab\there")]
    public void AnAppName_OutsideTheRules_Is400(string name)
    {
        var act = () => Brand.ValidAppName(name);

        act.Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("appName.invalid");
    }

    [Fact]
    public void ValidValues_PassTrimmed_AndAnythingElseIs400()
    {
        Brand.ValidAppName(" נשימה ").Should().Be("נשימה");
        Brand.ValidAccent("ocean").Should().Be("ocean");
        ((Action)(() => Brand.ValidAccent("#ff0000"))).Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("accentId.invalid");
        ((Action)(() => Brand.ValidIconBackground("white"))).Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("iconBackground.invalid");
    }

    [Fact]
    public void TheIconGround_IsPaper_OrTheAccent()
    {
        Brand.IconGroundHex("ocean", "paper").Should().Be(Brand.PaperHex);
        Brand.IconGroundHex("ocean", "accent").Should().Be("#4a7088");
    }

    [Fact]
    public void TheIcons_ComeInEverySize_OnTheirGround_WithTheMarkInTheSafeArea()
    {
        var icons = StudioIcons.Render(Mark(600, 600), "#4a7088")!;

        icons.Keys.Should().BeEquivalentTo("192", "512", "512-maskable", "180");
        foreach (var size in StudioIcons.Sizes)
        {
            using var png = SKBitmap.Decode(icons[size.Name]);
            png.Width.Should().Be(size.Side);
            png.Height.Should().Be(size.Side);
            png.GetPixel(0, 0).Should().Be(SKColor.Parse("#4a7088"), "the ground fills the corners");
            png.GetPixel(size.Side / 2, size.Side / 2).Should().Be(SKColors.White, "the mark sits in the middle");
        }

        // The maskable icon keeps the mark inside the circle of 80%: at 512, 100 px in from the edge is still ground.
        using var maskable = SKBitmap.Decode(icons["512-maskable"]);
        maskable.GetPixel(100, 256).Should().Be(SKColor.Parse("#4a7088"));
        using var plain = SKBitmap.Decode(icons["512"]);
        plain.GetPixel(100, 256).Should().Be(SKColors.White, "the plain icon gives the mark 72%");
    }

    [Theory]
    [InlineData("סטודיו נשימה", "סנ")]
    [InlineData("Flow studio", "FS")]
    [InlineData("yoga", "YO")]
    [InlineData("  ", "T")]
    [InlineData("ב׳ סטודיו", "בס")]
    public void TheInitials_AreTheFirstLettersOfTwoWords_OrOfOneWord(string name, string expected) =>
        StudioIcons.Initials(name).Should().Be(expected);

    [Fact]
    public void TheInitialsIcon_DrawsWhiteLettersOnTheAccent_InEverySize()
    {
        var icons = StudioIcons.RenderInitials("סטודיו נשימה", "#855f65");

        icons.Keys.Should().BeEquivalentTo("192", "512", "512-maskable", "180");
        using var png = SKBitmap.Decode(icons["512"]);
        png.GetPixel(0, 0).Should().Be(SKColor.Parse("#855f65"));
        var white = 0;
        for (var x = 0; x < 512; x += 2)
        {
            for (var y = 0; y < 512; y += 2)
            {
                if (png.GetPixel(x, y) == SKColors.White)
                {
                    white++;
                }
            }
        }

        white.Should().BeGreaterThan(500, "the embedded Hebrew face draws the letters");
    }

    private static byte[] Mark(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.White);
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    private static string RepoFile(params string[] parts)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine([dir.FullName, .. parts]);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"{Path.Combine(parts)} not found above the test output folder.");
    }
}
