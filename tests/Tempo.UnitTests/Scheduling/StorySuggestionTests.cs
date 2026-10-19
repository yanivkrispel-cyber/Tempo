using FluentAssertions;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>The weekly story's moment (docs/37 M-13): from the owner's day and time, in the studio's time, until the day ends.</summary>
public sealed class StorySuggestionTests
{
    [Theory]
    [InlineData("sun 09:00", "2026-10-18T09:00", true)]
    [InlineData("sun 09:00", "2026-10-18T23:59", true)]
    [InlineData("sun 09:00", "2026-10-18T08:59", false)]
    [InlineData("sun 09:00", "2026-10-19T09:30", false)]
    [InlineData("mon 00:00", "2026-10-19T00:00", true)]
    public void TheWeeklyStory_IsDueFromItsDayAndTime(string weekly, string local, bool due) =>
        InsightService.WeeklyStoryDue(weekly, DateTime.Parse(local, System.Globalization.CultureInfo.InvariantCulture)).Should().Be(due);
}
