using System.Globalization;
using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.Modules.Scheduling.Domain;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>The report period (docs/32 section 4, R-2): the default, the 92-day limit and the Sunday-to-Saturday weeks.</summary>
public sealed class ReportPeriodTests
{
    // Wednesday.
    private static readonly DateOnly Today = new(2026, 10, 21);

    [Fact]
    public void NoDates_AreTheLastFourFullWeeks()
    {
        var period = ReportPeriod.Resolve(null, null, Today);

        period.From.Should().Be(new DateOnly(2026, 9, 20));
        period.To.Should().Be(new DateOnly(2026, 10, 17));
        period.From.DayOfWeek.Should().Be(DayOfWeek.Sunday);
        period.To.DayOfWeek.Should().Be(DayOfWeek.Saturday);
        period.Weeks().Should().HaveCount(4);
    }

    [Fact]
    public void OnSunday_TheDefaultStillEndsYesterday()
    {
        ReportPeriod.Resolve(null, null, new DateOnly(2026, 10, 18)).To.Should().Be(new DateOnly(2026, 10, 17));
    }

    [Fact]
    public void NinetyTwoDays_AreAllowed_NinetyThreeAreNot()
    {
        var from = new DateOnly(2026, 7, 1);

        ReportPeriod.Resolve(from, from.AddDays(91), Today).Days.Should().Be(92);
        var tooLong = () => ReportPeriod.Resolve(from, from.AddDays(92), Today);
        tooLong.Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("report.period_too_long");
    }

    [Theory]
    [InlineData("2026-10-01", null)]
    [InlineData(null, "2026-10-01")]
    [InlineData("2026-10-02", "2026-10-01")]
    public void OneDateOrABackwardsPeriod_IsInvalid(string? from, string? to)
    {
        var resolve = () => ReportPeriod.Resolve(from is null ? null : DateOnly.Parse(from, CultureInfo.InvariantCulture), to is null ? null : DateOnly.Parse(to, CultureInfo.InvariantCulture), Today);

        resolve.Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("report.period_invalid");
    }

    [Fact]
    public void Weeks_AreCutToThePeriod()
    {
        // Thursday 2026-10-01 to Tuesday 2026-10-13: three weeks, the first and last partial.
        var weeks = new ReportPeriod(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 13)).Weeks();

        weeks.Select(w => w.WeekStart).Should().Equal(new DateOnly(2026, 9, 27), new DateOnly(2026, 10, 4), new DateOnly(2026, 10, 11));
        weeks[0].From.Should().Be(new DateOnly(2026, 10, 1));
        weeks[0].To.Should().Be(new DateOnly(2026, 10, 3));
        weeks[1].From.Should().Be(new DateOnly(2026, 10, 4));
        weeks[1].To.Should().Be(new DateOnly(2026, 10, 10));
        weeks[2].To.Should().Be(new DateOnly(2026, 10, 13));
    }

    [Fact]
    public void Previous_HasTheSameLength_AndEndsTheDayBefore()
    {
        var previous = new ReportPeriod(new DateOnly(2026, 10, 4), new DateOnly(2026, 10, 17)).Previous;

        previous.Should().Be(new ReportPeriod(new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 3)));
    }
}
