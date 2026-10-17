namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`ReportTotals` (docs/32 section 5) with its own `from` and `to`, which `previous` needs.</summary>
public sealed record ReportTotalsResponse(
    DateOnly From,
    DateOnly To,
    int SessionsHeld,
    int Capacity,
    int PlacesBooked,
    int Attended,
    int NoShow,
    int LateCancellations,
    decimal? FillRate,
    int ActiveMembers,
    int NewMembers);

public sealed record ReportWeekResponse(
    DateOnly WeekStart,
    DateOnly From,
    DateOnly To,
    int SessionsHeld,
    int Capacity,
    int PlacesBooked,
    int Attended,
    int NoShow,
    int LateCancellations,
    decimal? FillRate);

public sealed record ReportClassTypeResponse(
    Guid ClassTypeId,
    string Name,
    string Color,
    int SessionsHeld,
    int Capacity,
    int PlacesBooked,
    int Attended,
    int NoShow,
    int LateCancellations,
    decimal? FillRate);

/// <summary>`ReportSummary`.</summary>
public sealed record ReportSummaryResponse(
    DateOnly From,
    DateOnly To,
    string TimeZone,
    ReportTotalsResponse Totals,
    ReportTotalsResponse Previous,
    IReadOnlyList<ReportWeekResponse> Weeks,
    IReadOnlyList<ReportClassTypeResponse> ClassTypes);

/// <summary>`PassEndingRow`.</summary>
public sealed record PassEndingRowResponse(Guid PersonId, string DisplayName, Guid PassId, string ProductName, string Kind, DateOnly EndsOn, int? EntriesLeft, string Reason);

/// <summary>`PassesEndingReport`.</summary>
public sealed record PassesEndingReportResponse(DateOnly Today, IReadOnlyList<PassEndingRowResponse> Items, bool Truncated);

/// <summary>`MemberAtRiskRow`.</summary>
public sealed record MemberAtRiskRowResponse(Guid PersonId, string DisplayName, DateOnly? LastAttendedOn, DateOnly PassEndsOn);

/// <summary>`MembersAtRiskReport`.</summary>
public sealed record MembersAtRiskReportResponse(DateOnly Today, IReadOnlyList<MemberAtRiskRowResponse> Items, bool Truncated);
