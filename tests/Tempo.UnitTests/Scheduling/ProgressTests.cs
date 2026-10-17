using FluentAssertions;
using Tempo.Platform.Modules.Scheduling.Domain;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>docs/31 section 12 (G-2, G-3): visits this month and the streak of Sunday-to-Saturday weeks.</summary>
public sealed class ProgressTests
{
    // Wednesday 2026-10-21; its week runs from Sunday 2026-10-18 to Saturday 2026-10-24.
    private static readonly DateOnly Today = new(2026, 10, 21);

    [Fact]
    public void VisitsInMonth_CountsOnlyThisMonthsDates()
    {
        DateOnly[] attended = [new(2026, 9, 30), new(2026, 10, 1), new(2026, 10, 31), new(2025, 10, 5)];

        Progress.VisitsInMonth(attended, Today).Should().Be(2);
    }

    [Fact]
    public void Streak_CountsTheCurrentWeekOnceItHasAClass()
    {
        DateOnly[] attended = [new(2026, 10, 19), new(2026, 10, 13), new(2026, 10, 6)];

        Progress.StreakWeeks(attended, Today).Should().Be(3);
    }

    [Fact]
    public void Streak_AnEmptyCurrentWeek_DoesNotBreakIt()
    {
        DateOnly[] attended = [new(2026, 10, 17), new(2026, 10, 8)];

        Progress.StreakWeeks(attended, Today).Should().Be(2);
    }

    [Fact]
    public void Streak_AWeekWithoutAClass_EndsIt()
    {
        DateOnly[] attended = [new(2026, 10, 20), new(2026, 10, 12), new(2026, 9, 29)];

        Progress.StreakWeeks(attended, Today).Should().Be(2);
    }

    [Fact]
    public void Streak_SaturdayAndSundayAreDifferentWeeks()
    {
        // Saturday 10-17 closes last week, Sunday 10-18 opens this one: two weeks, not one.
        Progress.StreakWeeks([new DateOnly(2026, 10, 17), new DateOnly(2026, 10, 18)], Today).Should().Be(2);

        // Sunday 10-11 and Saturday 10-17 are the same week.
        Progress.StreakWeeks([new DateOnly(2026, 10, 11), new DateOnly(2026, 10, 17)], Today).Should().Be(1);
    }

    [Fact]
    public void Streak_IgnoresDatesAfterToday()
    {
        Progress.StreakWeeks([new DateOnly(2026, 10, 25)], Today).Should().Be(0);
    }

    [Fact]
    public void Streak_StopsAtTwoYears()
    {
        var everyWeek = Enumerable.Range(0, 200).Select(i => Today.AddDays(-7 * i));

        Progress.StreakWeeks(everyWeek, Today).Should().Be(Progress.MaxStreakWeeks);
    }

    [Fact]
    public void Since_CoversTheWholeStreakWindowAndTheMonth()
    {
        Progress.Since(Today).Should().Be(new DateOnly(2026, 10, 18).AddDays(-7 * Progress.MaxStreakWeeks));
    }
}
