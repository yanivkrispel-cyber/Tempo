using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Platform.Modules.Scheduling.Domain;

/// <summary>
/// The period of an owner report (docs/32 section 4, R-2): two dates in the studio's time zone, both included, at most
/// <see cref="MaxDays"/> days, and the Sunday-to-Saturday weeks that overlap it (G-2).
/// </summary>
public sealed record ReportPeriod(DateOnly From, DateOnly To)
{
    public const int MaxDays = 92;

    /// <summary>The console's default: the last <see cref="DefaultWeeks"/> full weeks before the current one.</summary>
    public const int DefaultWeeks = 4;

    public int Days => To.DayNumber - From.DayNumber + 1;

    /// <summary>The period of the same length that ends the day before <see cref="From"/>.</summary>
    public ReportPeriod Previous => new(From.AddDays(-Days), From.AddDays(-1));

    /// <summary>Both dates, or neither for the default; anything else is a 400.</summary>
    public static ReportPeriod Resolve(DateOnly? from, DateOnly? to, DateOnly today)
    {
        if (from is null && to is null)
        {
            var end = Progress.WeekStart(today).AddDays(-1);
            return new ReportPeriod(end.AddDays(-(7 * DefaultWeeks) + 1), end);
        }

        if (from is not { } start || to is not { } last)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "report.period_invalid", "Send both from and to, or neither.", from is null ? "from" : "to");
        }

        if (last < start)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "report.period_invalid", "to is before from.", "to");
        }

        var period = new ReportPeriod(start, last);
        return period.Days > MaxDays
            ? throw new DomainRuleViolationException(ViolationKind.Validation, "report.period_too_long", $"A report covers at most {MaxDays} days.", "to")
            : period;
    }

    /// <summary>Every week that overlaps the period, oldest first, with the part of it inside the period.</summary>
    public IReadOnlyList<(DateOnly WeekStart, DateOnly From, DateOnly To)> Weeks()
    {
        var weeks = new List<(DateOnly, DateOnly, DateOnly)>();
        for (var week = Progress.WeekStart(From); week <= To; week = week.AddDays(7))
        {
            var end = week.AddDays(6);
            weeks.Add((week, week < From ? From : week, end > To ? To : end));
        }

        return weeks;
    }
}
