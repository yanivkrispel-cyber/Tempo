using System.Globalization;
using FluentAssertions;
using Tempo.Platform.Modules.Scheduling.Domain;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>docs/29 section 13: a weekly class keeps its local time across both DST changes in Israel.</summary>
public sealed class StudioTimeTests
{
    private static readonly TimeZoneInfo Israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
    private static readonly TimeOnly HalfPastFive = new(17, 30);

    [Theory]
    [InlineData("2026-03-26", "2026-03-26T15:30:00Z")]   // Thursday, winter time (+02:00)
    [InlineData("2026-03-27", "2026-03-27T14:30:00Z")]   // Friday, summer time from 02:00 (+03:00)
    [InlineData("2026-10-24", "2026-10-24T14:30:00Z")]   // Saturday, still summer time
    [InlineData("2026-10-25", "2026-10-25T15:30:00Z")]   // Sunday, winter time again
    public void LocalStart_StaysAtHalfPastFive(string date, string utc) =>
        StudioTime.ToInstant(DateOnly.Parse(date, CultureInfo.InvariantCulture), HalfPastFive, Israel).Should().Be(DateTimeOffset.Parse(utc, CultureInfo.InvariantCulture));

    [Fact]
    public void ASkippedHour_MovesForward()
    {
        // 02:30 on 2026-03-27 does not exist in Israel; the class starts at 03:30 local, 00:30 UTC.
        StudioTime.ToInstant(new DateOnly(2026, 3, 27), new TimeOnly(2, 30), Israel).Should().Be(DateTimeOffset.Parse("2026-03-27T00:30:00Z", CultureInfo.InvariantCulture));
    }

    [Fact]
    public void Occurrences_AreTheWeekdayInsideBothRanges()
    {
        var tuesdays = StudioTime.Occurrences(2, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), new DateOnly(2026, 10, 15), new DateOnly(2026, 12, 10));

        tuesdays.Should().Equal(new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 27));
    }

    [Fact]
    public void Occurrences_StartOnTheFirstDayWhenItIsTheWeekday()
    {
        StudioTime.Occurrences(4, new DateOnly(2026, 10, 15), null, new DateOnly(2026, 10, 15), new DateOnly(2026, 10, 29))
            .Should().Equal(new DateOnly(2026, 10, 15), new DateOnly(2026, 10, 22), new DateOnly(2026, 10, 29));
    }
}
