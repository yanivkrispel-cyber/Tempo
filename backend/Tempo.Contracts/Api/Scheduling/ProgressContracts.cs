namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`MyProgress` in contracts/openapi/tempo-api.v1.yaml (docs/31 section 12).</summary>
public sealed record MyProgressResponse(string Month, string TimeZone, int VisitsThisMonth, int? MonthlyGoal, int StreakWeeks, IReadOnlyList<ProgressWeekResponse>? Weeks = null);

/// <summary>`ProgressWeek`: one Sunday-to-Saturday week of the last twelve (docs/33 section 10).</summary>
public sealed record ProgressWeekResponse(DateOnly WeekStart, int Attended, int Booked);

/// <summary>`MonthlyGoalRequest`: 1 to 31, or null to clear the goal.</summary>
public sealed record MonthlyGoalRequest(int? MonthlyGoal);
