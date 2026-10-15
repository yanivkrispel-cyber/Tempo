namespace Tempo.Platform.Modules.Scheduling.Domain;

/// <summary>
/// Wall-clock time in the studio's time zone (docs/29 section 2, `11_Scheduling_Engine.md` section 3): a
/// weekly class keeps its local start across the DST change, and every instant is stored in UTC.
/// </summary>
public static class StudioTime
{
    /// <summary>
    /// The UTC instant of a local date and time. A time that does not exist (the hour skipped when clocks go
    /// forward) moves forward by the skipped amount; a repeated hour takes its first occurrence.
    /// </summary>
    public static DateTimeOffset ToInstant(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
        {
            local = local.AddHours(1);
        }

        var offset = zone.IsAmbiguousTime(local) ? zone.GetAmbiguousTimeOffsets(local).Max() : zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    /// <summary>
    /// The dates on <paramref name="weekday"/> (0 = Sunday) between <paramref name="from"/> and
    /// <paramref name="until"/>, inside the template's own validity.
    /// </summary>
    public static IEnumerable<DateOnly> Occurrences(int weekday, DateOnly validFrom, DateOnly? validUntil, DateOnly from, DateOnly until)
    {
        var start = validFrom > from ? validFrom : from;
        var end = validUntil is { } v && v < until ? v : until;
        var first = start.AddDays(((weekday - (int)start.DayOfWeek) + 7) % 7);
        for (var date = first; date <= end; date = date.AddDays(7))
        {
            yield return date;
        }
    }
}
