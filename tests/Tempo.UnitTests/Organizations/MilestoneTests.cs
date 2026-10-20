using FluentAssertions;
using Tempo.Platform.Modules.Marketing;
using Xunit;

namespace Tempo.UnitTests.Organizations;

/// <summary>The milestone card's numbers (docs/37 section 8.2, M-16), from attended classes in the studio's time.</summary>
public sealed class MilestoneTests
{
    private static (DateTime, double, string?) Class(string local, string? instructor = null) =>
        (DateTime.Parse(local, System.Globalization.CultureInfo.InvariantCulture), 50 / 60.0, instructor);

    [Fact]
    public void TheNumbers_CountWeeksInARow_TheUsualTime_AndTheTopPublicInstructor()
    {
        var view = MemberMarketingService.Compute(
        [
            Class("2026-10-04T18:00", "דנה"), Class("2026-10-06T18:00", "דנה"), // week of 4.10
            Class("2026-10-12T07:00", "ליאור"),                                // week of 11.10
            Class("2026-10-20T18:00", null),                                   // week of 18.10
            Class("2026-11-03T18:00", "דנה")                                   // a gap, then the week of 1.11
        ]);

        view.Attended.Should().Be(5);
        view.Reached.Should().BeEmpty();
        view.Next.Should().Be(10);
        view.LongestWeekStreak.Should().Be(3);
        view.UsualTime.Should().Be("18:00");
        view.TopInstructor.Should().Be("דנה");
        view.HoursOnTheMat.Should().BeApproximately(4.2, 0.05);
    }

    [Fact]
    public void PastTheLastThreshold_ThereIsNoNext()
    {
        var view = MemberMarketingService.Compute([.. Enumerable.Range(0, 200).Select(i => Class("2026-01-04T08:00"))]);

        view.Reached.Should().Equal(10, 25, 50, 100, 200);
        view.Next.Should().BeNull();
    }
}
