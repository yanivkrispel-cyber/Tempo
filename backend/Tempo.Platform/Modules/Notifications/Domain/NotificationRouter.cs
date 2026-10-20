namespace Tempo.Platform.Modules.Notifications.Domain;

/// <summary>
/// The preference groups of docs/30 section 5. A member chooses channels per group; the inbox is always on.
/// </summary>
public static class NotificationGroups
{
    public const string Bookings = "bookings";
    public const string Reminders = "reminders";
    public const string Studio = "studio";

    /// <summary>A member's milestones and bring-a-friend rewards (docs/37 section 8, stage B); on by default.</summary>
    public const string Celebrations = "celebrations";

    public static readonly IReadOnlyList<string> All = [Bookings, Reminders, Studio, Celebrations];

    /// <summary>
    /// The group of a kind. Kinds are code (docs/30 section 5); a class message from staff is the studio group's
    /// `message_to_booked` and cannot be switched off; a kind not listed is a service notice.
    /// </summary>
    public static string Of(string kind) => kind switch
    {
        _ when kind.StartsWith("reminder.", StringComparison.Ordinal) => Reminders,
        "session.message" or "studio.announcement" => Studio,
        "member.milestone" or "member.referral_rewarded" => Celebrations,
        _ => Bookings
    };

    /// <summary>A notice about the member's own class: it goes out inside quiet hours when the class starts inside them (D-4).</summary>
    /// <summary>
    /// About a class the person booked, so it may go out in quiet hours when the class starts before they end. The
    /// class-soon reminder counts: held until 08:00 it would arrive after a 07:30 class began (review on #199).
    /// </summary>
    public static bool IsClassService(string kind) => Of(kind) == Bookings || kind is "session.message" or "reminder.class_soon";
}

/// <summary>A local window that may cross midnight, 22:00 to 08:00.</summary>
public sealed record QuietWindow(TimeOnly Starts, TimeOnly Ends)
{
    public bool Contains(TimeOnly time) => Starts < Ends
        ? time >= Starts && time < Ends
        : time >= Starts || time < Ends;
}

/// <summary>What the router knows about one request for one person, all times already in the studio's zone.</summary>
public sealed record RouteInput(
    string Kind,
    bool PushEnabled,
    bool HasPushSubscription,
    bool PushAvailable,
    QuietWindow Quiet,
    DateTime LocalNow,
    DateTime? ClassStartsLocal);

/// <summary>One delivery line: <see cref="NotBeforeLocal"/> is set when a queued delivery waits for quiet hours to end.</summary>
public sealed record RouteDecision(string Channel, string Status, string? SkipReason, DateTime? NotBeforeLocal);

/// <summary>
/// The router of docs/30 sections 7 and 8, as a pure function: the inbox is always delivered (the domain code
/// wrote the item); push is skipped with a reason, or queued, possibly until quiet hours end. Email waits for
/// D-1 and is not routed yet.
/// </summary>
public static class NotificationRouter
{
    public const string Inbox = "inbox";
    public const string Push = "push";

    public static RouteDecision RoutePush(RouteInput input)
    {
        if (!input.PushEnabled)
        {
            return Skipped("preference_off");
        }

        if (!input.HasPushSubscription)
        {
            return Skipped("no_subscription");
        }

        if (!input.PushAvailable)
        {
            return Skipped("channel_unavailable");
        }

        if (!input.Quiet.Contains(TimeOnly.FromDateTime(input.LocalNow)))
        {
            return new RouteDecision(Push, "queued", null, null);
        }

        var windowEnds = WindowEnd(input.Quiet, input.LocalNow);
        if (NotificationGroups.IsClassService(input.Kind) && input.ClassStartsLocal is { } starts && starts < windowEnds)
        {
            // The person asked to be told about a class that starts before they would wake up.
            return new RouteDecision(Push, "queued", null, null);
        }

        return new RouteDecision(Push, "queued", null, windowEnds);
    }

    /// <summary>The local end of the quiet window that contains <paramref name="localNow"/>.</summary>
    public static DateTime WindowEnd(QuietWindow quiet, DateTime localNow)
    {
        var end = localNow.Date + quiet.Ends.ToTimeSpan();
        return end > localNow ? end : end.AddDays(1);
    }

    private static RouteDecision Skipped(string reason) => new(Push, "skipped", reason, null);
}
