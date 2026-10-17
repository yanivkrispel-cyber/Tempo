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

/// <summary>`Sales`: pass sales at list price (docs/33 section 9.1, X-9); amounts in agorot.</summary>
public sealed record SalesResponse(string Month, string TimeZone, long SoFarAgorot, long PreviousToDateAgorot, long? ForecastAgorot, int PassesSold, int UnpricedCount, IReadOnlyList<SalesDayResponse> Days);

public sealed record SalesDayResponse(DateOnly Day, long CumulativeAgorot);

/// <summary>`Occupancy`: places over capacity per day and part of day (docs/33 section 9.2).</summary>
public sealed record OccupancyResponse(DateOnly WeekStart, string TimeZone, int Places, int Capacity, int? PreviousPlaces, int? PreviousCapacity, IReadOnlyList<OccupancyCellResponse> Cells);

public sealed record OccupancyCellResponse(DateOnly Day, string Part, int Places, int Capacity, bool FullWithWaitlist);

/// <summary>`Suggestion`: one "waiting for you" card (docs/33 section 9.3).</summary>
public sealed record SuggestionResponse(
    string Kind,
    int Count,
    IReadOnlyList<PersonRefResponse> People,
    long? AmountAgorot,
    Guid? SessionId,
    string? ClassName,
    DateTimeOffset? StartsAt,
    Guid? InstructorMembershipId,
    string? InstructorName,
    SuggestedSlotResponse? Slot);

public sealed record SuggestedSlotResponse(DateTimeOffset StartsAt, Guid? RoomId, string? RoomName);

public sealed record SuggestionListResponse(IReadOnlyList<SuggestionResponse> Items);

/// <summary>`Activity`: one line of "what happens now" (docs/33 section 9.4).</summary>
public sealed record ActivityResponse(string Kind, DateTimeOffset At, PersonRefResponse Person, string? ClassName, DateTimeOffset? ClassStartsAt, string? SpotLabel, string? ProductName, long? PriceAgorot);

public sealed record ActivityListResponse(IReadOnlyList<ActivityResponse> Items);

public sealed record SearchSessionResponse(Guid Id, string ClassName, DateTimeOffset StartsAt, string? InstructorName);

/// <summary>`SearchResults`: people and the next 14 days' classes (docs/33 section 9.5).</summary>
public sealed record SearchResponse(IReadOnlyList<PersonRefResponse> People, IReadOnlyList<SearchSessionResponse> Sessions);
