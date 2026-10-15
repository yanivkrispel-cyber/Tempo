namespace Tempo.Platform.Modules.Scheduling.Domain;

/// <summary>A live pass of one person with the session dates its held entries are on.</summary>
public sealed record PassCandidate(
    Guid Id,
    string Name,
    string Kind,
    DateOnly StartsOn,
    DateOnly EndsOn,
    int? Entries,
    int EntriesUsed,
    int? WeeklyCap,
    string? ClassCategory,
    IReadOnlyList<DateOnly> HeldDates)
{
    public int? EntriesLeft => Entries is { } entries ? entries - EntriesUsed : null;
}

/// <summary>
/// Which pass a booking uses (docs/29 section 5.3): valid on the session's date, allowed for its category,
/// with room left, and the one that ends first, memberships before cards on the same day.
/// </summary>
public static class PassSelection
{
    public static PassCandidate? Pick(IEnumerable<PassCandidate> passes, DateOnly sessionDate, string classCategory) =>
        passes
            .Where(p => p.StartsOn <= sessionDate && sessionDate <= p.EndsOn)
            .Where(p => p.ClassCategory is null || p.ClassCategory == classCategory)
            .Where(p => p.EntriesLeft is null or > 0)
            .Where(p => p.WeeklyCap is not { } cap || HeldInWeek(p, sessionDate) < cap)
            .OrderBy(p => p.EndsOn)
            .ThenBy(p => p.Kind == "membership" ? 0 : 1)
            .ThenBy(p => p.Id)
            .FirstOrDefault();

    /// <summary>Sunday of the week that holds <paramref name="date"/> (docs/29 section 5.4, C-5).</summary>
    public static DateOnly WeekStart(DateOnly date) => date.AddDays(-(int)date.DayOfWeek);

    private static int HeldInWeek(PassCandidate pass, DateOnly date)
    {
        var start = WeekStart(date);
        var end = start.AddDays(6);
        return pass.HeldDates.Count(d => d >= start && d <= end);
    }
}
