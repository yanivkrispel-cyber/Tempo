using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.Modules.Notifications.Domain;
using Xunit;

namespace Tempo.UnitTests.Notifications;

/// <summary>Templates of docs/30 section 6 and section 13 step 7: the closed variables, rendering as text, push cut, dates in words.</summary>
public sealed class NotificationTemplatesTests
{
    private static readonly TemplatedKind Promoted = TemplateCatalog.Find("booking.promoted")!;

    [Fact]
    public void Catalog_HasTheThirteenTemplatedKinds_AndNoneForStaffText()
    {
        TemplateCatalog.Kinds.Select(k => k.Kind).Should().BeEquivalentTo(
            "booking.promoted", "booking.promotion_failed", "booking.moved", "session.cancelled", "waitlist.expired", "pass.frozen",
            "reminder.class_tomorrow", "reminder.class_soon", "reminder.pass_ending", "reminder.entries_low",
            "reminder.event_week", "member.milestone", "member.referral_rewarded");
        TemplateCatalog.Find("member.milestone")!.Group.Should().Be("celebrations");
        TemplateCatalog.Find("member.referral_rewarded")!.Group.Should().Be("celebrations");
        TemplateCatalog.Find("reminder.event_week")!.Group.Should().Be("reminders");
        TemplateCatalog.Find("session.message").Should().BeNull();
        TemplateCatalog.Find("studio.announcement").Should().BeNull();
        TemplateCatalog.Find("pass.frozen")!.Variables.Should().Contain("pass.frozenUntil");
        TemplateCatalog.Find("reminder.entries_low")!.Variables.Should().NotContain("session.startsLocal");
    }

    [Fact]
    public void EveryDefault_UsesOnlyItsKindsVariables_AndRendersOnTheSampleValues()
    {
        foreach (var kind in TemplateCatalog.Kinds)
        {
            foreach (var channel in TemplateCatalog.Channels)
            {
                var words = TemplateCatalog.Default(kind, channel);
                FluentActions.Invoking(() => TemplateText.Validate(kind, words, channel)).Should().NotThrow(kind.Kind);
                TemplateText.RenderPush(words, TemplateCatalog.SampleValues).Body.Should().NotContain("{{");
            }
        }
    }

    [Fact]
    public void AnUnknownVariable_IsRefused_WithTheFieldAndTheVariable()
    {
        var act = () => TemplateText.Validate(Promoted, new("שלום {{person.firstName}}", "נשארו {{pass.entriesLeft}}"), "inbox");

        var error = act.Should().Throw<DomainRuleViolationException>().Which;
        error.Kind.Should().Be(ViolationKind.Validation);
        error.Code.Should().Be("template.unknown_variable");
        error.Field.Should().Be("inbox.body");
        error.Extensions!["variable"].Should().Be("pass.entriesLeft");
    }

    [Theory]
    [InlineData("", "גוף", "push.subject")]
    [InlineData("שורה\nשנייה", "גוף", "push.subject")]
    [InlineData("כותרת", " ", "push.body")]
    public void AnEmptyOrMultiLineText_IsInvalid(string subject, string body, string field)
    {
        var act = () => TemplateText.Validate(Promoted, new(subject, body), "push");

        var error = act.Should().Throw<DomainRuleViolationException>().Which;
        error.Code.Should().Be("template.invalid");
        error.Field.Should().Be(field);
    }

    [Fact]
    public void TooLongTexts_AreInvalid()
    {
        FluentActions.Invoking(() => TemplateText.Validate(Promoted, new(new string('א', 121), "גוף"), "inbox"))
            .Should().Throw<DomainRuleViolationException>().Which.Field.Should().Be("inbox.subject");
        FluentActions.Invoking(() => TemplateText.Validate(Promoted, new("כותרת", new string('א', 2001)), "inbox"))
            .Should().Throw<DomainRuleViolationException>().Which.Field.Should().Be("inbox.body");
    }

    [Fact]
    public void Values_GoInAsText_SoANameCannotBoldOrLink()
    {
        var values = new Dictionary<string, string> { ["person.firstName"] = "**[דנה](https://evil.example)**", ["studio.name"] = "סטודיו" };

        var inbox = TemplateText.RenderInbox(new("שלום {{ person.firstName }}", "**{{person.firstName}}**, ברוכה הבאה ל{{studio.name}}."), values);

        inbox.Subject.Should().Be("שלום **[דנה](https://evil.example)**", "the subject is plain text");
        inbox.Body.Should().Be(@"**\*\*\[דנה\]\(https://evil.example\)\*\***, ברוכה הבאה לסטודיו.");
    }

    [Fact]
    public void Push_IsTheFirstParagraph_WithoutMarkup_CutAt120()
    {
        var words = new TemplateWords("התפנה מקום", "**{{session.classTypeName}}** [בעמוד השיעור]({{link.session}})\n\nפסקה שנייה");
        var values = new Dictionary<string, string> { ["session.classTypeName"] = "יוגה", ["link.session"] = "/classes/1" };

        TemplateText.RenderPush(words, values).Should().Be(new TemplateWords("התפנה מקום", "יוגה בעמוד השיעור"));

        var longBody = TemplateText.RenderPush(new("כותרת", new string('א', 200)), values).Body;
        longBody.Should().HaveLength(120).And.EndWith("…");

        var emoji = TemplateText.RenderPush(new("כותרת", string.Concat(Enumerable.Repeat("🏃", 130))), values).Body;
        emoji.Should().Be(string.Concat(string.Concat(Enumerable.Repeat("🏃", 119)), "…"), "an emoji is never split into a lone surrogate");
    }

    [Fact]
    public void AMissingValue_RendersEmpty()
    {
        TemplateText.RenderInbox(new("בחדר {{session.room}}", "גוף"), new Dictionary<string, string>()).Subject.Should().Be("בחדר");
    }

    [Fact]
    public void Dates_ReadInWords_InTheStudiosTimeZone()
    {
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");

        TemplateDates.StartsLocal(new DateTimeOffset(2026, 10, 21, 15, 30, 0, TimeSpan.Zero), israel).Should().Be("יום רביעי, 21.10, בשעה 18:30");
        TemplateDates.Day(new DateOnly(2026, 11, 1)).Should().Be("יום ראשון, 1.11");
    }
}
