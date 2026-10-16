using FluentAssertions;
using Tempo.Platform.Modules.Notifications.Application;
using Xunit;

namespace Tempo.UnitTests.Notifications;

/// <summary>The studio's day for the announcements' daily limit (docs/30 section 13 step 7): it starts at local midnight, even where midnight is skipped.</summary>
public sealed class AnnouncementDayTests
{
    [Fact]
    public void TheDay_StartsAtTheJump_WhereTheClocksSkipMidnight()
    {
        // Chile moves from -04 to -03 at 00:00 on 6 September 2026, so that day's 00:00 never happens: it starts at
        // 04:00Z, which is 01:00 there.
        var santiago = TimeZoneInfo.FindSystemTimeZoneById("America/Santiago");
        santiago.IsInvalidTime(Local(2026, 9, 6)).Should().BeTrue("the test needs the skipped midnight");

        AnnouncementService.MidnightUtc(Local(2026, 9, 6), santiago).Should().Be(new DateTimeOffset(2026, 9, 6, 4, 0, 0, TimeSpan.Zero));
        AnnouncementService.MidnightUtc(Local(2026, 9, 7), santiago).Should().Be(new DateTimeOffset(2026, 9, 7, 3, 0, 0, TimeSpan.Zero));
    }

    [Fact]
    public void TheDay_StartsAtLocalMidnight_OnAnOrdinaryDay()
    {
        var jerusalem = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");

        AnnouncementService.MidnightUtc(Local(2026, 10, 16), jerusalem).Should().Be(new DateTimeOffset(2026, 10, 15, 21, 0, 0, TimeSpan.Zero));
        AnnouncementService.MidnightUtc(Local(2026, 12, 1), jerusalem).Should().Be(new DateTimeOffset(2026, 11, 30, 22, 0, 0, TimeSpan.Zero));
    }

    private static DateTime Local(int year, int month, int day) => new(year, month, day, 0, 0, 0, DateTimeKind.Unspecified);
}
