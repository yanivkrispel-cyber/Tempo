using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Platform.Modules.Notifications.Domain;

/// <summary>A subject (the inbox title, the push title) and a Markdown-light body with `{{variables}}`.</summary>
public sealed record TemplateWords(string Subject, string Body);

/// <summary>A kind a studio may word (docs/30 section 13 step 7): its group, closed variables and platform defaults.</summary>
public sealed record TemplatedKind(string Kind, string Group, IReadOnlyList<string> Variables, TemplateWords Inbox, TemplateWords Push);

/// <summary>
/// The templated kinds and their platform defaults, kept in code (migration 0014: "part one renders the platform
/// defaults from code"). The Hebrew defaults read like the apps' own text before step 7, so nothing changes for a
/// studio that never edits. `session.message` and `studio.announcement` carry the staff's text and have none.
/// </summary>
public static class TemplateCatalog
{
    public const string Inbox = "inbox";
    public const string Push = "push";
    public const string DefaultLocale = "he";

    public static readonly IReadOnlyList<string> Channels = [Inbox, Push];
    public static readonly IReadOnlyList<string> Locales = ["he", "en"];

    private static readonly string[] Common = ["person.firstName", "studio.name", "link.preferences"];
    private static readonly string[] Session = [.. Common, "session.classTypeName", "session.startsLocal", "session.room", "link.session"];
    private static readonly string[] Pass = [.. Common, "pass.entriesLeft"];

    private const string ClassLine = "{{session.classTypeName}}, {{session.startsLocal}}";

    private static readonly IReadOnlyList<TemplatedKind> All =
    [
        Class("booking.promoted", "התפנה מקום ונרשמת", "נרשמת אוטומטית מרשימת ההמתנה, ונוצלה כניסה מהכרטיסייה."),
        Class("booking.promotion_failed", "התפנה מקום, אבל אין כרטיסייה בתוקף", "לכן יצאת מרשימת ההמתנה. כדי להירשם, פנו לסטודיו."),
        Class("booking.moved", "הסטודיו העביר אותך לשיעור אחר", "המקום שלך עבר לשיעור הזה, עם אותה כניסה: לא נוצלה כניסה נוספת."),
        Class("session.cancelled", "הסטודיו ביטל שיעור", "אם נרשמת, הכניסה חזרה אליך."),
        Class("waitlist.expired", "לא התפנה מקום", "השיעור התחיל ורשימת ההמתנה נסגרה. לא נוצלה כניסה."),
        new("pass.frozen", NotificationGroups.Bookings, [.. Pass, "pass.frozenUntil"],
            new("הסטודיו הקפיא את המנוי שלך", "בימי ההקפאה אי אפשר להירשם לשיעורים, והתוקף של המנוי הוארך באותו מספר ימים."),
            new("המנוי הוקפא", "הפרטים בתיבת ההודעות באפליקציה.")),
        Class("reminder.class_tomorrow", "תזכורת: יש לך שיעור מחר", "אם התוכניות השתנו, אפשר לבטל בעמוד השיעור ולפנות את המקום."),
        Class("reminder.class_soon", "תזכורת: השיעור מתחיל בקרוב", "כל הפרטים בעמוד השיעור."),
        PassKind("reminder.pass_ending", "המנוי או הכרטיסייה עומדים לפוג", "כדי להמשיך להירשם לשיעורים, פנו לסטודיו לחידוש."),
        PassKind("reminder.entries_low", "נשארו מעט כניסות בכרטיסייה", "כדי להמשיך להירשם לשיעורים, פנו לסטודיו לכרטיסייה חדשה.")
    ];

    private static readonly Dictionary<string, TemplatedKind> ByKind = All.ToDictionary(k => k.Kind, StringComparer.Ordinal);

    /// <summary>The demo studio's values, for the console's preview (no real person's data).</summary>
    public static readonly IReadOnlyDictionary<string, string> SampleValues = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["person.firstName"] = "נועה",
        ["studio.name"] = "סטודיו לדוגמה",
        ["link.preferences"] = "/profile/notifications",
        ["session.classTypeName"] = "יוגה ויניאסה",
        ["session.startsLocal"] = "יום רביעי, 21.10, בשעה 18:30",
        ["session.room"] = "האולם הגדול",
        ["link.session"] = "/classes/00000000-0000-7000-8000-000000000001",
        ["pass.entriesLeft"] = "2",
        ["pass.frozenUntil"] = "יום ראשון, 1.11"
    };

    public static IReadOnlyList<TemplatedKind> Kinds => All;

    public static TemplatedKind? Find(string kind) => ByKind.GetValueOrDefault(kind);

    /// <summary>The platform default; English has none yet, so it falls back to Hebrew.</summary>
    public static TemplateWords Default(TemplatedKind kind, string channel) => channel == Push ? kind.Push : kind.Inbox;

    private static TemplatedKind Class(string kind, string subject, string body) =>
        new(kind, NotificationGroups.Of(kind), Session, new(subject, body), new(subject, ClassLine));

    private static TemplatedKind PassKind(string kind, string subject, string body) =>
        new(kind, NotificationGroups.Of(kind), Pass, new(subject, body), new(subject, body));
}

/// <summary>
/// Checks and renders template words (docs/30 section 6): variables are `{{name}}` from the kind's closed list, values
/// go in as text, the body is Markdown-light (paragraphs, `**bold**`, `[text](link)`), never HTML.
/// </summary>
public static partial class TemplateText
{
    public const int SubjectMax = 120;
    public const int BodyMax = 2000;
    public const int PushBodyMax = 120;

    [GeneratedRegex(@"\{\{\s*([^{}]*?)\s*\}\}", RegexOptions.None, 100)]
    private static partial Regex Variable();

    [GeneratedRegex(@"\[([^\]]*)\]\([^)]*\)", RegexOptions.None, 100)]
    private static partial Regex Link();

    [GeneratedRegex(@"\s+", RegexOptions.None, 100)]
    private static partial Regex Spaces();

    [GeneratedRegex(@"\n\s*\n", RegexOptions.None, 100)]
    private static partial Regex Paragraph();

    /// <summary>Throws 400 `template.invalid` or `template.unknown_variable` naming <paramref name="field"/> (`inbox.subject`, ...).</summary>
    public static void Validate(TemplatedKind kind, TemplateWords words, string field)
    {
        Check(words.Subject, SubjectMax, $"{field}.subject", singleLine: true);
        Check(words.Body, BodyMax, $"{field}.body", singleLine: false);
        foreach (var (text, part) in new[] { (words.Subject, "subject"), (words.Body, "body") })
        {
            foreach (Match match in Variable().Matches(text))
            {
                var name = match.Groups[1].Value;
                if (!kind.Variables.Contains(name, StringComparer.Ordinal))
                {
                    throw new DomainRuleViolationException(
                        ViolationKind.Validation, "template.unknown_variable", $"{{{{{name}}}}} is not a variable of {kind.Kind}.", $"{field}.{part}")
                    {
                        Extensions = new Dictionary<string, object?> { ["variable"] = name }
                    };
                }
            }
        }
    }

    /// <summary>The inbox words: a plain subject and the Markdown-light body with the values neutralized.</summary>
    public static TemplateWords RenderInbox(TemplateWords words, IReadOnlyDictionary<string, string> values) =>
        new(Plain(Fill(words.Subject, values, Raw)), Fill(words.Body, values, Escape).Trim());

    /// <summary>The push words: a plain title and the first paragraph, plain, cut at 120 characters.</summary>
    public static TemplateWords RenderPush(TemplateWords words, IReadOnlyDictionary<string, string> values)
    {
        var first = Paragraph().Split(words.Body.Replace("\r\n", "\n", StringComparison.Ordinal).Trim())[0];
        var body = Plain(Fill(Unmark(first), values, Raw));
        return new(Plain(Fill(words.Subject, values, Raw)), body.Length <= PushBodyMax ? body : string.Concat(body.AsSpan(0, PushBodyMax - 1).TrimEnd(), "…"));
    }

    private static void Check(string text, int max, string field, bool singleLine)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > max || (singleLine && text.Contains('\n', StringComparison.Ordinal)))
        {
            throw new DomainRuleViolationException(
                ViolationKind.Validation, "template.invalid", singleLine ? $"Write one line of 1 to {max} characters." : $"Write 1 to {max} characters.", field);
        }
    }

    private static string Fill(string text, IReadOnlyDictionary<string, string> values, Func<string, string> encode) =>
        Variable().Replace(text, m => encode(values.GetValueOrDefault(m.Groups[1].Value) ?? ""));

    private static string Raw(string value) => value;

    /// <summary>A value is text: Markdown-light's own characters are escaped with a backslash, so a name cannot bold or link.</summary>
    private static string Escape(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            if (c is '\\' or '*' or '[' or ']' or '(' or ')')
            {
                builder.Append('\\');
            }

            builder.Append(c);
        }

        return builder.ToString();
    }

    private static string Unmark(string text) => Link().Replace(text, m => m.Groups[1].Value).Replace("**", "", StringComparison.Ordinal);

    private static string Plain(string text) => Spaces().Replace(text, " ").Trim();
}

/// <summary>Dates in words that read right to left (docs/30 section 6): "יום רביעי, 21.10, בשעה 18:30", never a dash.</summary>
public static class TemplateDates
{
    private static readonly string[] HebrewDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

    public static string Day(DateOnly date) =>
        $"יום {HebrewDays[(int)date.DayOfWeek]}, {date.Day.ToString(CultureInfo.InvariantCulture)}.{date.Month.ToString(CultureInfo.InvariantCulture)}";

    public static string StartsLocal(DateTimeOffset startsAt, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(startsAt, zone);
        return $"{Day(DateOnly.FromDateTime(local.DateTime))}, בשעה {local.ToString("HH:mm", CultureInfo.InvariantCulture)}";
    }
}
