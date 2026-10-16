using FluentAssertions;
using Tempo.Platform.Modules.Notifications.Domain;
using Xunit;

namespace Tempo.UnitTests.Notifications;

/// <summary>The push routing rules of docs/30 sections 7 and 8, and D-4 (quiet hours 22:00 to 08:00).</summary>
public sealed class NotificationRouterTests
{
    private static readonly QuietWindow Night = new(new TimeOnly(22, 0), new TimeOnly(8, 0));

    [Theory]
    [InlineData("booking.promoted", NotificationGroups.Bookings)]
    [InlineData("waitlist.expired", NotificationGroups.Bookings)]
    [InlineData("pass.frozen", NotificationGroups.Bookings)]
    [InlineData("reminder.class_soon", NotificationGroups.Reminders)]
    [InlineData("session.message", NotificationGroups.Studio)]
    public void EveryKind_HasAGroup(string kind, string group) => NotificationGroups.Of(kind).Should().Be(group);

    [Fact]
    public void PreferenceOff_ComesFirst()
    {
        var decision = NotificationRouter.RoutePush(Input("booking.promoted", pushEnabled: false));
        decision.Should().Be(new RouteDecision("push", "skipped", "preference_off", null));
    }

    [Fact]
    public void NoSubscription_IsSkipped()
    {
        NotificationRouter.RoutePush(Input("booking.promoted", hasSubscription: false)).SkipReason.Should().Be("no_subscription");
    }

    [Fact]
    public void WithoutThePushAdapter_NothingLeavesTheApp()
    {
        NotificationRouter.RoutePush(Input("booking.promoted", available: false)).SkipReason.Should().Be("channel_unavailable");
    }

    [Fact]
    public void OutsideQuietHours_GoesOutAtOnce()
    {
        NotificationRouter.RoutePush(Input("reminder.class_soon", now: At(0, 15, 0))).Should().Be(new RouteDecision("push", "queued", null, null));
    }

    [Fact]
    public void AReminderInsideQuietHours_WaitsForTheMorning()
    {
        NotificationRouter.RoutePush(Input("reminder.class_tomorrow", now: At(0, 23, 0))).NotBeforeLocal.Should().Be(At(1, 8, 0));
        NotificationRouter.RoutePush(Input("session.message", now: At(1, 3, 0))).NotBeforeLocal.Should().Be(At(1, 8, 0), "after midnight the window ends the same morning");
    }

    [Fact]
    public void APromotionAt23_ForA07Class_GoesOutAtOnce()
    {
        NotificationRouter.RoutePush(Input("booking.promoted", now: At(0, 23, 0), classStarts: At(1, 7, 0))).NotBeforeLocal.Should().BeNull();
        NotificationRouter.RoutePush(Input("session.message", now: At(0, 23, 0), classStarts: At(1, 7, 0))).NotBeforeLocal.Should().BeNull("a class message about a class before morning is a service message");
    }

    [Fact]
    public void AClassSoonReminderAt07_ForA0730Class_GoesOutAtOnce()
    {
        NotificationRouter.RoutePush(Input("reminder.class_soon", now: At(1, 7, 0), classStarts: At(1, 7, 30))).NotBeforeLocal.Should().BeNull("held until 08:00 it would come after the class began");
        NotificationRouter.RoutePush(Input("reminder.class_soon", now: At(1, 7, 0), classStarts: At(1, 9, 0))).NotBeforeLocal.Should().Be(At(1, 8, 0), "a class after the window: the reminder waits for its end");
        NotificationRouter.RoutePush(Input("reminder.pass_ending", now: At(1, 7, 0))).NotBeforeLocal.Should().Be(At(1, 8, 0));
    }

    [Fact]
    public void ABookingNoticeForALaterClass_WaitsForTheMorning()
    {
        NotificationRouter.RoutePush(Input("booking.promoted", now: At(0, 23, 0), classStarts: At(1, 18, 0))).NotBeforeLocal.Should().Be(At(1, 8, 0));
    }

    [Fact]
    public void AWindowInsideOneDay_Works()
    {
        var afternoon = new QuietWindow(new TimeOnly(13, 0), new TimeOnly(15, 0));
        afternoon.Contains(new TimeOnly(14, 0)).Should().BeTrue();
        afternoon.Contains(new TimeOnly(15, 0)).Should().BeFalse();
        Night.Contains(new TimeOnly(22, 0)).Should().BeTrue();
        Night.Contains(new TimeOnly(8, 0)).Should().BeFalse();
    }

    private static DateTime At(int day, int hour, int minute) => new DateTime(2026, 10, 20, hour, minute, 0, DateTimeKind.Unspecified).AddDays(day);

    private static RouteInput Input(string kind, bool pushEnabled = true, bool hasSubscription = true, bool available = true, DateTime? now = null, DateTime? classStarts = null) =>
        new(kind, pushEnabled, hasSubscription, available, Night, now ?? At(0, 12, 0), classStarts);
}
