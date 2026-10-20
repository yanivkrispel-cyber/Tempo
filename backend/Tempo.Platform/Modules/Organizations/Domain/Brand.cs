using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Platform.Modules.Organizations.Domain;

/// <summary>
/// The rules of a studio's brand (docs/35 sections 2 and 3, WL1): eight accents by id, never a free colour; an app
/// name of 1 to 12 characters; the icon on paper or on the accent. The accents and their light `brand` value mirror
/// `packages/design-system/tokens/tokens.json` (`accents`); a unit test keeps them equal.
/// </summary>
public static class Brand
{
    public const int AppNameMaxLength = 12;
    public const string DefaultAccent = "sage";
    public const string DefaultIconBackground = "paper";

    /// <summary>The design system's `paper` (light), the icon's default ground.</summary>
    public const string PaperHex = "#fbfaf8";

    /// <summary>Each accent's light `--brand`, the ground of an icon on the accent and the manifest's theme colour.</summary>
    public static readonly IReadOnlyDictionary<string, string> Accents = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["sage"] = "#56735b",
        ["olive"] = "#6b6e43",
        ["ocean"] = "#4a7088",
        ["plum"] = "#7a607c",
        ["rose"] = "#855f65",
        ["terracotta"] = "#8c5d4b",
        ["sand"] = "#7c664c",
        ["graphite"] = "#6e6a65"
    };

    public static readonly IReadOnlyList<string> IconBackgrounds = ["paper", "accent"];

    /// <summary>The ground an icon is drawn on: paper, or the accent's light value.</summary>
    public static string IconGroundHex(string accentId, string iconBackground) =>
        iconBackground == "accent" && Accents.TryGetValue(accentId, out var hex) ? hex : PaperHex;

    /// <summary>The studio's display name when it fits under an icon, else its first word, cut at 12 characters.</summary>
    public static string DefaultAppName(string displayName)
    {
        var name = displayName.Trim();
        if (Length(name) <= AppNameMaxLength)
        {
            return name;
        }

        var first = name.Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries)[0];
        return Cut(first, AppNameMaxLength);
    }

    /// <summary>A trimmed app name of 1 to 12 characters without control characters, else 400 `appName.invalid`.</summary>
    public static string ValidAppName(string? appName)
    {
        var name = appName?.Trim() ?? string.Empty;
        if (Length(name) is < 1 or > AppNameMaxLength || name.Any(char.IsControl))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "appName.invalid", "The app name is 1 to 12 characters.", "appName");
        }

        return name;
    }

    public static string ValidAccent(string? accentId) =>
        accentId is not null && Accents.ContainsKey(accentId)
            ? accentId
            : throw new DomainRuleViolationException(ViolationKind.Validation, "accentId.invalid", "Choose one of the eight accents.", "accentId");

    public static string ValidIconBackground(string? iconBackground) =>
        iconBackground is not null && IconBackgrounds.Contains(iconBackground)
            ? iconBackground
            : throw new DomainRuleViolationException(ViolationKind.Validation, "iconBackground.invalid", "The icon's background is paper or accent.", "iconBackground");

    /// <summary>Characters as PostgreSQL's char_length counts them (code points), so the check and the column agree.</summary>
    private static int Length(string value) => value.EnumerateRunes().Count();

    private static string Cut(string value, int max)
    {
        var info = new StringInfo(value);
        var result = new System.Text.StringBuilder();
        for (var i = 0; i < info.LengthInTextElements; i++)
        {
            var element = info.SubstringByTextElements(i, 1);
            if (Length(result.ToString()) + Length(element) > max)
            {
                break;
            }

            result.Append(element);
        }

        return result.ToString();
    }
}
