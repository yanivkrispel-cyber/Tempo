using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Domain;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary>The figures of a week, a class type or a whole period (docs/32 section 5, R-3).</summary>
public sealed record ReportFigures(int SessionsHeld, int Capacity, int PlacesBooked, int Attended, int NoShow, int LateCancellations)
{
    public static readonly ReportFigures Empty = new(0, 0, 0, 0, 0, 0);

    /// <summary>Attended over capacity, 3 places; null when nothing was held.</summary>
    public decimal? FillRate => Capacity == 0 ? null : Math.Round((decimal)Attended / Capacity, 3, MidpointRounding.AwayFromZero);

    public ReportFigures Add(ReportFigures other) => new(
        SessionsHeld + other.SessionsHeld,
        Capacity + other.Capacity,
        PlacesBooked + other.PlacesBooked,
        Attended + other.Attended,
        NoShow + other.NoShow,
        LateCancellations + other.LateCancellations);
}

public sealed record ReportTotals(DateOnly From, DateOnly To, ReportFigures Figures, int ActiveMembers, int NewMembers);

public sealed record ReportWeekView(DateOnly WeekStart, DateOnly From, DateOnly To, ReportFigures Figures);

public sealed record ReportClassTypeView(Guid ClassTypeId, string Name, string Color, ReportFigures Figures);

public sealed record ReportSummaryView(string TimeZone, ReportTotals Totals, ReportTotals Previous, IReadOnlyList<ReportWeekView> Weeks, IReadOnlyList<ReportClassTypeView> ClassTypes);

public sealed record PassEndingView(Guid PersonId, string DisplayName, Guid PassId, string ProductName, string Kind, DateOnly EndsOn, int? EntriesLeft, string Reason);

public sealed record MemberAtRiskView(Guid PersonId, string DisplayName, DateOnly? LastAttendedOn, DateOnly PassEndsOn);

public sealed record ReportList<T>(DateOnly Today, IReadOnlyList<T> Items, bool Truncated);

/// <summary>
/// Owner reports (docs/32): computed live from sessions, bookings, passes and people under RLS, with no table of their
/// own (R-5). Names appear only in the two lists, which need `people.view` as well (R-6); nothing reads health data.
/// </summary>
public interface IReportService
{
    Task<ReportSummaryView> GetSummaryAsync(TenantContext tenant, DateOnly? firstDay, DateOnly? lastDay, CancellationToken cancellationToken);

    Task<ReportList<PassEndingView>> ListPassesEndingAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<ReportList<MemberAtRiskView>> ListMembersAtRiskAsync(TenantContext tenant, CancellationToken cancellationToken);
}

public sealed class ReportService(IDataSourceProvider dataSources, TimeProvider clock) : IReportService
{
    /// <summary>Rows per list (R-4); the query reads one more to know whether the list is cut.</summary>
    public const int ListLimit = 50;

    public const int EndingWithinDays = 14;

    public const int AtRiskAfterDays = 30;

    public async Task<ReportSummaryView> GetSummaryAsync(TenantContext tenant, DateOnly? firstDay, DateOnly? lastDay, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var period = ReportPeriod.Resolve(firstDay, lastDay, Today(zone));
        var now = clock.GetUtcNow();

        var sessions = await HeldSessionsAsync(unitOfWork, tenant.OrganizationId, period, now, cancellationToken);
        var previousSessions = await HeldSessionsAsync(unitOfWork, tenant.OrganizationId, period.Previous, now, cancellationToken);

        var weeks = period.Weeks()
            .Select(week => new ReportWeekView(
                week.WeekStart,
                week.From,
                week.To,
                Sum(sessions.Where(s => s.LocalDate >= week.From && s.LocalDate <= week.To))))
            .ToList();

        var names = await ClassTypeNamesAsync(unitOfWork, tenant.OrganizationId, [.. sessions.Select(s => s.ClassTypeId).Distinct()], cancellationToken);
        var classTypes = sessions
            .GroupBy(s => s.ClassTypeId)
            .Select(group => new ReportClassTypeView(group.Key, names[group.Key].Name, names[group.Key].Color, Sum(group)))
            .OrderByDescending(c => c.Figures.Attended)
            .ThenBy(c => c.Name, StringComparer.Ordinal)
            .ToList();

        var totals = await TotalsAsync(unitOfWork, tenant.OrganizationId, period, zone, sessions, cancellationToken);
        var previous = await TotalsAsync(unitOfWork, tenant.OrganizationId, period.Previous, zone, previousSessions, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new ReportSummaryView(zone.Id, totals, previous, weeks, classTypes);
    }

    public async Task<ReportList<PassEndingView>> ListPassesEndingAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        Require(tenant, Permissions.PeopleView);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var today = Today(await TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken));
        var soon = today.AddDays(EndingWithinDays);

        var rows = new List<PassEndingView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT p.person_id, pe.display_name, p.id, pp.name, pp.kind, p.ends_on,
                   CASE WHEN p.entries IS NULL THEN NULL ELSE p.entries - p.entries_used END
            FROM scheduling.passes p
            JOIN people.people pe ON pe.organization_id = p.organization_id AND pe.id = p.person_id
            JOIN scheduling.pass_products pp ON pp.organization_id = p.organization_id AND pp.id = p.product_id
            WHERE p.organization_id = $1 AND p.status = 'active' AND pe.status = 'active'
              AND p.starts_on <= $2 AND p.ends_on >= $2
              AND (p.entries IS NULL OR p.entries_used < p.entries)
              AND (p.ends_on <= $3 OR p.entries - p.entries_used = 1)
              AND NOT EXISTS (
                  SELECT 1 FROM scheduling.passes n
                  WHERE n.organization_id = p.organization_id AND n.person_id = p.person_id AND n.id <> p.id
                    AND n.status = 'active' AND n.ends_on > $3 AND (n.entries IS NULL OR n.entries_used < n.entries))
            ORDER BY p.ends_on, p.id
            LIMIT $4
            """,
            tenant.OrganizationId, today, soon, ListLimit + 1))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var endsOn = await reader.GetFieldValueAsync<DateOnly>(5, cancellationToken);
                rows.Add(new PassEndingView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetGuid(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    endsOn,
                    await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetInt32(6),
                    endsOn <= soon ? "ends_soon" : "last_entry"));
            }
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return Cut(today, rows);
    }

    public async Task<ReportList<MemberAtRiskView>> ListMembersAtRiskAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        Require(tenant, Permissions.PeopleView);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var today = Today(await TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken));
        var since = today.AddDays(-AtRiskAfterDays);

        var rows = new List<MemberAtRiskView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT pe.id, pe.display_name,
                   (SELECT max(s.local_date) FROM scheduling.bookings b
                    JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
                    WHERE b.organization_id = pe.organization_id AND b.person_id = pe.id
                      AND b.status = 'attended' AND s.local_date <= $2) AS last_attended_on,
                   max(p.ends_on)
            FROM people.people pe
            JOIN scheduling.passes p ON p.organization_id = pe.organization_id AND p.person_id = pe.id
            WHERE pe.organization_id = $1 AND pe.status = 'active'
              AND p.status = 'active' AND p.starts_on <= $2 AND p.ends_on >= $2
              AND (p.entries IS NULL OR p.entries_used < p.entries)
              AND NOT EXISTS (SELECT 1 FROM scheduling.pass_freezes f
                              WHERE f.organization_id = p.organization_id AND f.pass_id = p.id
                                AND $2 BETWEEN f.starts_on AND f.ends_on)
            GROUP BY pe.organization_id, pe.id, pe.display_name
            HAVING min(p.starts_on) <= $3
               AND NOT EXISTS (SELECT 1 FROM scheduling.bookings b
                               JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
                               WHERE b.organization_id = pe.organization_id AND b.person_id = pe.id
                                 AND b.status = 'attended' AND s.local_date > $3 AND s.local_date <= $2)
            ORDER BY last_attended_on NULLS FIRST, pe.id
            LIMIT $4
            """,
            tenant.OrganizationId, today, since, ListLimit + 1))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new MemberAtRiskView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    await reader.IsDBNullAsync(2, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(2, cancellationToken),
                    await reader.GetFieldValueAsync<DateOnly>(3, cancellationToken)));
            }
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return Cut(today, rows);
    }

    private sealed record HeldSession(DateOnly LocalDate, Guid ClassTypeId, ReportFigures Figures);

    /// <summary>Sessions not cancelled that have started, with their booking counts (docs/32 section 5).</summary>
    private static async Task<List<HeldSession>> HeldSessionsAsync(UnitOfWork unitOfWork, Guid organizationId, ReportPeriod period, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var sessions = new List<HeldSession>();
        await using var command = unitOfWork.Command(
            """
            SELECT s.local_date, s.class_type_id, s.capacity,
                   count(b.id) FILTER (WHERE b.status IN ('booked', 'attended', 'no_show')),
                   count(b.id) FILTER (WHERE b.status = 'attended'),
                   count(b.id) FILTER (WHERE b.status = 'no_show'),
                   count(b.id) FILTER (WHERE b.status = 'cancelled' AND b.late_cancel)
            FROM scheduling.sessions s
            LEFT JOIN scheduling.bookings b ON b.organization_id = s.organization_id AND b.session_id = s.id
            WHERE s.organization_id = $1 AND s.local_date BETWEEN $2 AND $3
              AND s.status = 'scheduled' AND s.starts_at <= $4
            GROUP BY s.organization_id, s.id
            """,
            organizationId, period.From, period.To, now);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            sessions.Add(new HeldSession(
                await reader.GetFieldValueAsync<DateOnly>(0, cancellationToken),
                reader.GetGuid(1),
                new ReportFigures(1, reader.GetInt32(2), (int)reader.GetInt64(3), (int)reader.GetInt64(4), (int)reader.GetInt64(5), (int)reader.GetInt64(6))));
        }

        return sessions;
    }

    private static async Task<ReportTotals> TotalsAsync(UnitOfWork unitOfWork, Guid organizationId, ReportPeriod period, TimeZoneInfo zone, IEnumerable<HeldSession> sessions, CancellationToken cancellationToken)
    {
        await using var active = unitOfWork.Command(
            """
            SELECT count(DISTINCT b.person_id)
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            LEFT JOIN organizations.memberships m ON m.organization_id = p.organization_id AND m.id = p.membership_id
            WHERE b.organization_id = $1 AND b.status = 'attended' AND s.local_date BETWEEN $2 AND $3
              AND (m.id IS NULL OR m.role = 'client')
            """,
            organizationId, period.From, period.To);
        var activeMembers = (long)(await active.ExecuteScalarAsync(cancellationToken))!;

        // Merged duplicates would count one person twice. In both counts, staff records (a non-client membership) are
        // not members, even when an instructor takes a class.
        await using var joined = unitOfWork.Command(
            """
            SELECT count(*)
            FROM people.people p
            LEFT JOIN organizations.memberships m ON m.organization_id = p.organization_id AND m.id = p.membership_id
            WHERE p.organization_id = $1
              AND (p.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
              AND p.status <> 'merged'
              AND (m.id IS NULL OR m.role = 'client')
            """,
            organizationId, period.From, period.To, zone.Id);
        var newMembers = (long)(await joined.ExecuteScalarAsync(cancellationToken))!;

        return new ReportTotals(period.From, period.To, Sum(sessions), (int)activeMembers, (int)newMembers);
    }

    private static async Task<Dictionary<Guid, (string Name, string Color)>> ClassTypeNamesAsync(UnitOfWork unitOfWork, Guid organizationId, Guid[] ids, CancellationToken cancellationToken)
    {
        var names = new Dictionary<Guid, (string, string)>();
        await using var command = unitOfWork.Command(
            "SELECT id, name, color FROM scheduling.class_types WHERE organization_id = $1 AND id = ANY($2)",
            organizationId, ids);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            names[reader.GetGuid(0)] = (reader.GetString(1), reader.GetString(2));
        }

        return names;
    }

    private static ReportFigures Sum(IEnumerable<HeldSession> sessions) =>
        sessions.Aggregate(ReportFigures.Empty, (total, session) => total.Add(session.Figures));

    private static ReportList<T> Cut<T>(DateOnly today, List<T> rows) =>
        new(today, rows.Count > ListLimit ? rows.GetRange(0, ListLimit) : rows, rows.Count > ListLimit);

    private static void Require(TenantContext tenant, string permission)
    {
        if (!tenant.Has(permission))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You do not have permission to do this.");
        }
    }

    private DateOnly Today(TimeZoneInfo zone) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
