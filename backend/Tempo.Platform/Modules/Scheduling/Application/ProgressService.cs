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
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        return await ReadAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
    }

    public async Task<ProgressView> SetMyGoalAsync(TenantContext tenant, int? monthlyGoal, CancellationToken cancellationToken)
    {
        if (monthlyGoal is < 1 or > 31)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "monthlyGoal.invalid", "Use 1 to 31, or clear the goal.", "monthlyGoal");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
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
        var view = await ReadAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    private async Task<ProgressView> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, CancellationToken cancellationToken)
    {
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);

        // Only attended places count (G-3); a session's local_date is its day in the studio's time zone.
        var attended = new List<DateOnly>();
        await using (var command = unitOfWork.Command(
            """
            SELECT s.local_date
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status = 'attended' AND s.local_date >= $3
            """,
            organizationId, person, Progress.Since(today)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                attended.Add(await reader.GetFieldValueAsync<DateOnly>(0, cancellationToken));
            }
        }

        // Places still booked this week, for the current week's dot (docs/33 section 10).
        var booked = new List<DateOnly>();
        await using (var command = unitOfWork.Command(
            """
            SELECT s.local_date
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status = 'booked' AND s.local_date BETWEEN $3 AND $4
            """,
            organizationId, person, today, Progress.WeekStart(today).AddDays(6)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                booked.Add(await reader.GetFieldValueAsync<DateOnly>(0, cancellationToken));
            }
        }

        await using var goal = unitOfWork.Command(
            "SELECT monthly_goal FROM scheduling.member_goals WHERE organization_id = $1 AND person_id = $2",
            organizationId, person);
        var monthlyGoal = await goal.ExecuteScalarAsync(cancellationToken) is short value ? (int?)value : null;

        return new ProgressView(
            today.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            zone.Id,
            Progress.VisitsInMonth(attended, today),
            monthlyGoal,
            Progress.StreakWeeks(attended, today),
            [.. Progress.Weeks(attended, booked, today).Select(w => new ProgressWeekView(w.WeekStart, w.Attended, w.Booked))]);
    }

    private static async Task<Guid> MyPersonIdAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2 AND status = 'active'",
            tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid id
            ? id
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Your record in this studio was not found.");
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
