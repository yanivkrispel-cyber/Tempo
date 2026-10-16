using System.Text;
using FluentAssertions;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>docs/29 section 16.3: the "add to calendar" file follows RFC 5545 (escaping, folding, UTC times).</summary>
public sealed class CalendarFileTests
{
    [Fact]
    public void Escape_ALoneCarriageReturnOrOtherControlCharacter_CannotStartANewLine()
    {
        // #157: a lone CR in a class, room or studio name would end the content line.
        CalendarFile.Escape("Room\rBEGIN:VEVENT").Should().Be("Room\\nBEGIN:VEVENT");
        CalendarFile.Escape("a\u0000b\u000bc\td").Should().Be("abc\td", "a tab is allowed in TEXT, other controls are dropped");
    }

    [Fact]
    public void Escape_CoversBackslashSemicolonCommaAndNewline()
    {
        CalendarFile.Escape("a,b;c\\d\ne\r\nf").Should().Be("a\\,b\\;c\\\\d\\ne\\nf");
    }

    [Fact]
    public void Fold_BreaksLongLinesAt75Octets_WithoutSplittingHebrewCharacters()
    {
        var hebrew = string.Concat(Enumerable.Repeat("שיעור פילאטיס מכשירים בבוקר ", 5)).TrimEnd();
        var line = $"DESCRIPTION:{hebrew}";

        var folded = CalendarFile.Fold(line);

        var physical = folded.Split("\r\n ");
        physical.Should().HaveCountGreaterThan(1);
        physical.Should().OnlyContain(p => Encoding.UTF8.GetByteCount(p) <= 75);
        string.Concat(physical).Should().Be(line, "unfolding gives the original back, so no character was cut in two");
        CalendarFile.Fold("SUMMARY:short").Should().Be("SUMMARY:short");
    }

    [Fact]
    public void Event_IsOnePublishedVEvent_InUtc_WithCrLfLineEnds()
    {
        var start = new DateTimeOffset(2026, 10, 20, 10, 0, 0, TimeSpan.FromHours(3));

        var content = CalendarFile.Event("b1@tempo", start.AddDays(-1), start, start.AddMinutes(50), "פילאטיס", "סטודיו, חדר 2", "עם דנה");

        content.Should().StartWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n").And.EndWith("END:VEVENT\r\nEND:VCALENDAR\r\n");
        content.Should().Contain("METHOD:PUBLISH\r\n").And.Contain("UID:b1@tempo\r\n");
        content.Should().Contain("DTSTART:20261020T070000Z\r\n").And.Contain("DTEND:20261020T075000Z\r\n", "studio time 10:00 +03:00 is 07:00Z");
        content.Should().Contain("LOCATION:סטודיו\\, חדר 2\r\n");
        content.Split("\r\n").Should().OnlyContain(l => !l.Contains('\n') && !l.Contains('\r'));
    }
}
