namespace Tempo.Platform.Modules.Scheduling.Domain;

/// <summary>
/// A member's visits this month and streak of weeks (docs/31 section 12, G-2 and G-3), from the local dates of
/// the classes they attended. Local dates are the session's date in the studio's time zone, so a class at 23:30 on
/// the last day of the month counts for that month even when UTC is already in the next one.
/// </summary>
public static class Progress
{
    /// <summary>The walk back stops here; two years of weeks is more than any screen shows.</summary>
    public const int MaxStreakWeeks = 104;

    public static int VisitsInMonth(IEnumerable<DateOnly> attended, DateOnly today) =>
        attended.Count(date => date.Year == today.Year && date.Month == today.Month);

    /// <summary>
    /// Consecutive Sunday-to-Saturday weeks with at least one attended class. The current week counts once it has
    /// one; until then the streak runs from last week and is not broken. Attended dates after today are ignored.
    /// </summary>
    public static int StreakWeeks(IEnumerable<DateOnly> attended, DateOnly today)
    {
        var weeks = attended.Where(date => date <= today).Select(WeekStart).ToHashSet();
        var week = WeekStart(today);
        var streak = 0;
        if (weeks.Contains(week))
        {
            streak = 1;
        }

        for (week = week.AddDays(-7); streak < MaxStreakWeeks && weeks.Contains(week); week = week.AddDays(-7))
        {
            streak++;
        }

        return streak;
    }

    /// <summary>The Sunday that starts the week of <paramref name="date"/>.</summary>
    public static DateOnly WeekStart(DateOnly date) => date.AddDays(-(int)date.DayOfWeek);

    /// <summary>The earliest local date that can still matter for <see cref="StreakWeeks"/> and this month.</summary>
    public static DateOnly Since(DateOnly today)
    {
        var streakStart = WeekStart(today).AddDays(-7 * MaxStreakWeeks);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        return streakStart < monthStart ? streakStart : monthStart;
    }
}
