using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Domain;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary><paramref name="Month"/> is `yyyy-MM` in the studio's time zone.</summary>
public sealed record ProgressWeekView(DateOnly WeekStart, int Attended, int Booked);

public sealed record ProgressView(string Month, string TimeZone, int VisitsThisMonth, int? MonthlyGoal, int StreakWeeks, IReadOnlyList<ProgressWeekView>? Weeks = null);

/// <summary>The member's own progress in one studio: visits, goal and streak (docs/31 section 12).</summary>
public interface IProgressService
{
    Task<ProgressView> GetMineAsync(TenantContext tenant, CancellationToken cancellationToken);

    /// <summary>Sets the goal (1 to 31), or clears it with null (G-1).</summary>
    Task<ProgressView> SetMyGoalAsync(TenantContext tenant, int? monthlyGoal, CancellationToken cancellationToken);
}

public sealed class ProgressService(IDataSourceProvider dataSources, TimeProvider clock) : IProgressService
{
    public async Task<ProgressView> GetMineAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadAsync(unitOfWork, tenant, cancellationToken);
    }

    public async Task<ProgressView> SetMyGoalAsync(TenantContext tenant, int? monthlyGoal, CancellationToken cancellationToken)
    {
        if (monthlyGoal is < 1 or > 31)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "monthlyGoal.invalid", "Use 1 to 31, or clear the goal.", "monthlyGoal");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = (await MineAsync(unitOfWork, tenant, cancellationToken)).Person;
        await using (var command = monthlyGoal is { } goal
            ? unitOfWork.Command(
                """
                INSERT INTO scheduling.member_goals (organization_id, person_id, monthly_goal, updated_at) VALUES ($1, $2, $3, now())
                ON CONFLICT (organization_id, person_id) DO UPDATE SET monthly_goal = $3, updated_at = now()
                """,
                tenant.OrganizationId, person, (short)goal)
            : unitOfWork.Command("DELETE FROM scheduling.member_goals WHERE organization_id = $1 AND person_id = $2", tenant.OrganizationId, person))
        {
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        // A member's own goal is not audited: it is their own setting, like a notification preference.
        var view = await ReadAsync(unitOfWork, tenant, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    /// <summary>
    /// Two statements (board #537, K2): the person, the studio's time zone and the goal, then the attended and booked
    /// days. The second needs today in the studio's zone, which the first gives.
    /// </summary>
    private async Task<ProgressView> ReadAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        var (person, zone, monthlyGoal) = await MineAsync(unitOfWork, tenant, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);

        // Only attended places count (G-3); a session's local_date is its day in the studio's time zone. Places still
        // booked this week are for the current week's dot (docs/33 section 10). UNION ALL keeps each half on its own
        // index (the attended half on 0039's partial one).
        var attended = new List<DateOnly>();
        var booked = new List<DateOnly>();
        await using (var command = unitOfWork.Command(
            """
            SELECT s.local_date, true
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status = 'attended' AND s.local_date >= $3
            UNION ALL
            SELECT s.local_date, false
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status = 'booked' AND s.local_date BETWEEN $4 AND $5
            """,
            tenant.OrganizationId, person, Progress.Since(today), today, Progress.WeekStart(today).AddDays(6)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                (reader.GetBoolean(1) ? attended : booked).Add(await reader.GetFieldValueAsync<DateOnly>(0, cancellationToken));
            }
        }

        return new ProgressView(
            today.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            zone.Id,
            Progress.VisitsInMonth(attended, today),
            monthlyGoal,
            Progress.StreakWeeks(attended, today),
            [.. Progress.Weeks(attended, booked, today).Select(w => new ProgressWeekView(w.WeekStart, w.Attended, w.Booked))]);
    }

    /// <summary>The caller's active person in this studio, the studio's time zone and the monthly goal, in one read.</summary>
    private static async Task<(Guid Person, TimeZoneInfo Zone, int? MonthlyGoal)> MineAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT p.id, o.time_zone, g.monthly_goal
            FROM people.people p
            LEFT JOIN organizations.organizations o ON o.id = p.organization_id
            LEFT JOIN scheduling.member_goals g ON g.organization_id = p.organization_id AND g.person_id = p.id
            WHERE p.organization_id = $1 AND p.membership_id = $2 AND p.status = 'active'
            """,
            tenant.OrganizationId, tenant.MembershipId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Your record in this studio was not found.");
        }

        var zone = await reader.IsDBNullAsync(1, cancellationToken) ? "Asia/Jerusalem" : reader.GetString(1);
        int? goal = await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetInt16(2);
        return (reader.GetGuid(0), TimeZoneInfo.FindSystemTimeZoneById(zone), goal);
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
