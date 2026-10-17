namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`MyProgress` in contracts/openapi/tempo-api.v1.yaml (docs/31 section 12).</summary>
public sealed record MyProgressResponse(string Month, string TimeZone, int VisitsThisMonth, int? MonthlyGoal, int StreakWeeks);

/// <summary>`MonthlyGoalRequest`: 1 to 31, or null to clear the goal.</summary>
public sealed record MonthlyGoalRequest(int? MonthlyGoal);
