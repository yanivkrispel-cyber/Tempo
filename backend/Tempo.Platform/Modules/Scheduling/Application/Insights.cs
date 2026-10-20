using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record SalesDayView(DateOnly Day, long CumulativeAgorot);

/// <summary>
/// Pass sales of a month at list price (docs/33 X-9: no payments yet, so this is "מכירות", never revenue).
/// <paramref name="ForecastAgorot"/> is null before the third day; <paramref name="PreviousToDateAgorot"/> is the
/// previous month up to the same day.
/// </summary>
public sealed record SalesView(string Month, string TimeZone, long SoFarAgorot, long PreviousToDateAgorot, long? ForecastAgorot, int PassesSold, int UnpricedCount, IReadOnlyList<SalesDayView> Days);

/// <summary>One cell of the week's occupancy: a day and a part of it (morning, noon, evening).</summary>
public sealed record OccupancyCellView(DateOnly Day, string Part, int Places, int Capacity, bool FullWithWaitlist);

public sealed record OccupancyView(DateOnly WeekStart, string TimeZone, int Places, int Capacity, int? PreviousPlaces, int? PreviousCapacity, IReadOnlyList<OccupancyCellView> Cells);

public sealed record SuggestedSlotView(DateTimeOffset StartsAt, Guid? RoomId, string? RoomName);

/// <summary>
/// One "waiting for you" card (docs/33 section 9.3). Kind members_at_risk, passes_ending or waitlist_pressure;
/// the people are the first three; amounts in agorot.
/// </summary>
public sealed record SuggestionView(
    string Kind,
    int Count,
    IReadOnlyList<PersonRefView> People,
    long? AmountAgorot = null,
    Guid? SessionId = null,
    string? ClassName = null,
    DateTimeOffset? StartsAt = null,
    Guid? InstructorMembershipId = null,
    string? InstructorName = null,
    SuggestedSlotView? Slot = null);

/// <summary>One line of "what happens now" (docs/33 section 9.4).</summary>
public sealed record ActivityView(
    string Kind,
    DateTimeOffset At,
    PersonRefView Person,
    Guid? AvatarMediaId,
    string? ClassName = null,
    DateTimeOffset? ClassStartsAt = null,
    string? SpotLabel = null,
    string? ProductName = null,
    long? PriceAgorot = null);

public sealed record SearchSessionView(Guid Id, string ClassName, DateTimeOffset StartsAt, string? InstructorName);

public sealed record SearchView(IReadOnlyList<PersonRefView> People, IReadOnlyList<SearchSessionView> Sessions);

/// <summary>
/// The owner's console at a glance (docs/33 section 9): computed live under RLS like the reports (X-10), in the
/// studio's time zone. Everything needs `reports.view`; anything with names needs `people.view` too.
/// </summary>
public interface IInsightService
{
    Task<SalesView> SalesAsync(TenantContext tenant, string? month, CancellationToken cancellationToken);

    Task<OccupancyView> OccupancyAsync(TenantContext tenant, DateOnly? weekStart, CancellationToken cancellationToken);

    Task<IReadOnlyList<SuggestionView>> SuggestionsAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<IReadOnlyList<ActivityView>> ActivityAsync(TenantContext tenant, int limit, CancellationToken cancellationToken);

    /// <summary>People (with `people.view`) and the next 14 days' classes matching <paramref name="query"/>.</summary>
    Task<SearchView> SearchAsync(TenantContext tenant, string? query, CancellationToken cancellationToken);
}

public sealed class InsightService(IDataSourceProvider dataSources, TimeProvider clock, IReportService reports) : IInsightService
{
    private const int WaitlistPressure = 4;
    private static readonly TimeSpan ActivityWindow = TimeSpan.FromHours(48);

    public async Task<SalesView> SalesAsync(TenantContext tenant, string? month, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var today = Today(zone);
        var first = new DateOnly(today.Year, today.Month, 1);
        if (month is not null && !DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out first))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "month.invalid", "Use yyyy-MM.", "month");
        }
        var last = first.AddMonths(1).AddDays(-1);
        var throughDay = today >= first && today <= last ? today.Day : last.Day;
        var previousFirst = first.AddMonths(-1);
        var previousThrough = previousFirst.AddDays(Math.Min(throughDay, DateTime.DaysInMonth(previousFirst.Year, previousFirst.Month)) - 1);

        var byDay = new SortedDictionary<DateOnly, long>();
        var sold = 0;
        var unpriced = 0;
        long previous = 0;
        await using (var command = unitOfWork.Command(
            """
            SELECT (ps.created_at AT TIME ZONE $4)::date, pp.price_agorot
            FROM scheduling.passes ps
            JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
            WHERE ps.organization_id = $1 AND ps.status <> 'voided'
              AND (ps.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
            """,
            tenant.OrganizationId, previousFirst, last, zone.Id))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var day = await reader.GetFieldValueAsync<DateOnly>(0, cancellationToken);
                var price = await reader.IsDBNullAsync(1, cancellationToken) ? (long?)null : reader.GetInt32(1);
                if (day < first)
                {
                    previous += day <= previousThrough ? price ?? 0 : 0;
                    continue;
                }

                sold++;
                unpriced += price is null ? 1 : 0;
                byDay[day] = byDay.GetValueOrDefault(day) + (price ?? 0);
            }
        }

        var days = new List<SalesDayView>();
        long running = 0;
        for (var day = first; day <= first.AddDays(throughDay - 1); day = day.AddDays(1))
        {
            running += byDay.GetValueOrDefault(day);
            days.Add(new SalesDayView(day, running));
        }

        long? forecast = throughDay >= 3 && today <= last && today >= first
            ? (long)Math.Round((double)running / throughDay * last.Day / 100, MidpointRounding.AwayFromZero) * 100
            : null;
        return new SalesView(first.ToString("yyyy-MM", CultureInfo.InvariantCulture), zone.Id, running, previous, forecast, sold, unpriced, days);
    }

    public async Task<OccupancyView> OccupancyAsync(TenantContext tenant, DateOnly? weekStart, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var start = Domain.Progress.WeekStart(weekStart ?? Today(zone));
        var cells = await CellsAsync(unitOfWork, tenant.OrganizationId, zone, start, cancellationToken);
        var previous = await CellsAsync(unitOfWork, tenant.OrganizationId, zone, start.AddDays(-7), cancellationToken);
        return new OccupancyView(
            start,
            zone.Id,
            cells.Sum(c => c.Places),
            cells.Sum(c => c.Capacity),
            previous.Count == 0 ? null : previous.Sum(c => c.Places),
            previous.Count == 0 ? null : previous.Sum(c => c.Capacity),
            cells);
    }

    public async Task<IReadOnlyList<SuggestionView>> SuggestionsAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        var cards = new List<SuggestionView>();
        if (tenant.Has(Permissions.PeopleView))
        {
            var atRisk = await reports.ListMembersAtRiskAsync(tenant, cancellationToken);
            if (atRisk.Items.Count > 0)
            {
                cards.Add(new SuggestionView("members_at_risk", atRisk.Items.Count, [.. atRisk.Items.Take(3).Select(m => new PersonRefView(m.PersonId, m.DisplayName))]));
            }

            var ending = await reports.ListPassesEndingAsync(tenant, cancellationToken);
            if (ending.Items.Count > 0)
            {
                await using var prices = await BeginAsync(tenant, cancellationToken);
                await using var sum = prices.Command(
                    """
                    SELECT coalesce(sum(pp.price_agorot), 0)::bigint FROM scheduling.passes ps
                    JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
                    WHERE ps.organization_id = $1 AND ps.id = ANY($2)
                    """,
                    tenant.OrganizationId, ending.Items.Select(e => e.PassId).ToArray());
                var amount = (long)(await sum.ExecuteScalarAsync(cancellationToken))!;
                cards.Add(new SuggestionView("passes_ending", ending.Items.Count, [.. ending.Items.Take(3).Select(e => new PersonRefView(e.PersonId, e.DisplayName))], amount));
            }
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        if (await PressureAsync(unitOfWork, tenant.OrganizationId, cancellationToken) is { } pressure)
        {
            cards.Add(pressure);
        }

        if (tenant.Has(Permissions.MarketingPublish))
        {
            cards.AddRange(await StorySuggestionsAsync(unitOfWork, tenant.OrganizationId, cancellationToken));
        }

        // Money at stake first: renewals, then the people who stopped coming, then a class that could open, then stories.
        return [.. cards.OrderBy(c => c.Kind switch { "passes_ending" => 0, "members_at_risk" => 1, "waitlist_pressure" => 2, _ => 3 })];
    }

    /// <summary>A place frees up this close to the class (after the waitlist closed) and is still worth a story.</summary>
    public static readonly TimeSpan StoryLeadTime = TimeSpan.FromMinutes(90);

    /// <summary>
    /// Story suggestions for a studio whose public page is on (docs/37 section 7.4, M-13), at most one of each, so at
    /// most three: the weekly story from the owner's day and time on, a place that freed up after the waitlist
    /// closed (at least 90 minutes before the class), and a timetable change in the next 7 days (a cancelled class or
    /// a new instructor in the last 24 hours). Live, like the other cards; no table and no job.
    /// </summary>
    private async Task<IReadOnlyList<SuggestionView>> StorySuggestionsAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        string? weekly;
        await using (var page = unitOfWork.Command(
            "SELECT suggest_weekly_at FROM organizations.public_pages WHERE organization_id = $1 AND enabled",
            organizationId))
        await using (var reader = await page.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return [];
            }

            weekly = reader.IsDBNull(0) ? null : reader.GetString(0);
        }

        var now = clock.GetUtcNow();
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var local = TimeZoneInfo.ConvertTime(now, zone).DateTime;
        var cards = new List<SuggestionView>();
        if (weekly is not null && WeeklyStoryDue(weekly, local))
        {
            await using var week = unitOfWork.Command(
                "SELECT count(*) FROM scheduling.sessions WHERE organization_id = $1 AND status = 'scheduled' AND local_date BETWEEN $2 AND $3",
                organizationId, DateOnly.FromDateTime(local), DateOnly.FromDateTime(local).AddDays(6));
            cards.Add(new SuggestionView("story_weekly", (int)(long)(await week.ExecuteScalarAsync(cancellationToken))!, []));
        }

        await using (var opened = unitOfWork.Command(
            """
            SELECT s.id, ct.name, s.starts_at, s.capacity - s.booked_count
            FROM scheduling.sessions s
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            LEFT JOIN scheduling.booking_policies bp ON bp.organization_id = s.organization_id
            WHERE s.organization_id = $1 AND s.status = 'scheduled' AND s.booked_count < s.capacity
              AND s.starts_at > $2 AND $3 >= s.starts_at - make_interval(hours => coalesce(bp.waitlist_cutoff_hours, 2))
              AND EXISTS (SELECT 1 FROM scheduling.bookings b
                          WHERE b.organization_id = s.organization_id AND b.session_id = s.id AND b.status = 'cancelled'
                            AND b.cancelled_at >= s.starts_at - make_interval(hours => coalesce(bp.waitlist_cutoff_hours, 2)))
            ORDER BY s.starts_at
            LIMIT 1
            """,
            organizationId, now.Add(StoryLeadTime), now))
        await using (var reader = await opened.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                cards.Add(new SuggestionView("story_spot_opened", reader.GetInt32(3), [], null, reader.GetGuid(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2)));
            }
        }

        await using (var changed = unitOfWork.Command(
            """
            SELECT count(*) FROM scheduling.sessions s
            WHERE s.organization_id = $1 AND s.starts_at BETWEEN $2 AND $2 + interval '7 days'
              AND ((s.status = 'cancelled' AND s.updated_at >= $2 - interval '24 hours')
                   OR EXISTS (SELECT 1 FROM audit.audit_events a
                              WHERE a.organization_id = s.organization_id AND a.target_id = s.id AND a.action = 'session.updated'
                                AND a.data ->> 'instructor' = 'true' AND a.occurred_at >= $2 - interval '24 hours'))
            """,
            organizationId, now))
        {
            var count = (int)(long)(await changed.ExecuteScalarAsync(cancellationToken))!;
            if (count > 0)
            {
                cards.Add(new SuggestionView("story_schedule_changed", count, []));
            }
        }

        return cards;
    }

    /// <summary>`sun 09:00`: due from that day and time until the day ends, in the studio's time.</summary>
    public static bool WeeklyStoryDue(string weekly, DateTime local)
    {
        var parts = weekly.Split(' ');
        var day = Array.IndexOf(["sun", "mon", "tue", "wed", "thu", "fri", "sat"], parts[0]);
        return day == (int)local.DayOfWeek
            && TimeOnly.TryParseExact(parts[1], "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var at)
            && TimeOnly.FromDateTime(local) >= at;
    }

    public async Task<IReadOnlyList<ActivityView>> ActivityAsync(TenantContext tenant, int limit, CancellationToken cancellationToken)
    {
        Require(tenant, Permissions.ReportsView);
        Require(tenant, Permissions.PeopleView);
        limit = Math.Clamp(limit, 1, 50);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            SELECT a.action, a.occurred_at, p.id, p.display_name, p.avatar_media_id, ct.name, s.starts_at, rs.label, pp.name, pp.price_agorot
            FROM audit.audit_events a
            LEFT JOIN scheduling.bookings b ON a.target_type = 'booking' AND b.organization_id = a.organization_id AND b.id = a.target_id
            LEFT JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            LEFT JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            LEFT JOIN scheduling.room_spots rs ON rs.organization_id = b.organization_id AND rs.id = b.spot_id
            LEFT JOIN scheduling.passes ps ON a.target_type = 'pass' AND ps.organization_id = a.organization_id AND ps.id = a.target_id
            LEFT JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
            LEFT JOIN people.health_declarations hd ON a.action = 'health.declaration.signed' AND hd.organization_id = a.organization_id AND hd.id = a.target_id
            JOIN people.people p ON p.organization_id = a.organization_id AND p.id = coalesce(b.person_id, ps.person_id, hd.person_id) AND p.status = 'active'
            WHERE a.organization_id = $1 AND a.occurred_at > $2
              AND a.action IN ('booking.created', 'booking.waitlisted', 'booking.cancelled', 'booking.promoted', 'booking.checked_in', 'pass.granted', 'health.declaration.signed')
            ORDER BY a.occurred_at DESC
            LIMIT $3
            """,
            tenant.OrganizationId, clock.GetUtcNow().Subtract(ActivityWindow), limit);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var items = new List<ActivityView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new ActivityView(
                reader.GetString(0),
                await reader.GetFieldValueAsync<DateTimeOffset>(1, cancellationToken),
                new PersonRefView(reader.GetGuid(2), reader.GetString(3)),
                await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetGuid(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5),
                await reader.IsDBNullAsync(6, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(6, cancellationToken),
                await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetString(7),
                await reader.IsDBNullAsync(8, cancellationToken) ? null : reader.GetString(8),
                await reader.IsDBNullAsync(9, cancellationToken) ? null : reader.GetInt32(9)));
        }

        return items;
    }

    public async Task<SearchView> SearchAsync(TenantContext tenant, string? query, CancellationToken cancellationToken)
    {
        var text = query?.Trim() ?? "";
        if (text.Length < 2)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "q.too_short", "Type at least 2 characters.", "q");
        }

        Require(tenant, Permissions.ScheduleView);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var people = new List<PersonRefView>();
        if (tenant.Has(Permissions.PeopleView))
        {
            await using var command = unitOfWork.Command(
                """
                SELECT p.id, p.display_name FROM people.people p
                WHERE p.organization_id = $1 AND p.status = 'active' AND p.display_name ILIKE '%' || $2 || '%'
                ORDER BY position(lower($2) in lower(p.display_name)), p.display_name
                LIMIT 8
                """,
                tenant.OrganizationId, EscapeLike(text));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                people.Add(new PersonRefView(reader.GetGuid(0), reader.GetString(1)));
            }
        }

        var sessions = new List<SearchSessionView>();
        var now = clock.GetUtcNow();
        await using (var command = unitOfWork.Command(
            """
            SELECT s.id, ct.name, s.starts_at, ip.display_name
            FROM scheduling.sessions s
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            LEFT JOIN people.people ip ON ip.organization_id = s.organization_id AND ip.membership_id = s.instructor_membership_id
            WHERE s.organization_id = $1 AND s.status = 'scheduled' AND s.starts_at > $3 AND s.starts_at < $3 + interval '14 days'
              AND (ct.name ILIKE '%' || $2 || '%' OR ip.display_name ILIKE '%' || $2 || '%')
            ORDER BY s.starts_at
            LIMIT 8
            """,
            tenant.OrganizationId, EscapeLike(text), now))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                sessions.Add(new SearchSessionView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken),
                    await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetString(3)));
            }
        }

        return new SearchView(people, sessions);
    }

    /// <summary>Morning is before 12:00, noon until 16:59, evening from 17:00, at the class's local start.</summary>
    public static string PartOfDay(TimeOnly start) => start.Hour switch
    {
        < 12 => "morning",
        < 17 => "noon",
        _ => "evening"
    };

    private static async Task<List<OccupancyCellView>> CellsAsync(UnitOfWork unitOfWork, Guid organizationId, TimeZoneInfo zone, DateOnly start, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT s.local_date, (s.starts_at AT TIME ZONE $4)::time, s.booked_count, s.capacity,
                   EXISTS (SELECT 1 FROM scheduling.bookings w WHERE w.organization_id = s.organization_id AND w.session_id = s.id AND w.status = 'waitlisted')
            FROM scheduling.sessions s
            WHERE s.organization_id = $1 AND s.status = 'scheduled' AND s.local_date BETWEEN $2 AND $3
            """,
            organizationId, start, start.AddDays(6), zone.Id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<(DateOnly Day, string Part, int Places, int Capacity, bool Pressure)>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var booked = reader.GetInt32(2);
            var capacity = reader.GetInt32(3);
            rows.Add((
                await reader.GetFieldValueAsync<DateOnly>(0, cancellationToken),
                PartOfDay(TimeOnly.FromTimeSpan(await reader.GetFieldValueAsync<TimeSpan>(1, cancellationToken))),
                booked,
                capacity,
                booked >= capacity && reader.GetBoolean(4)));
        }

        return [.. rows
            .GroupBy(r => (r.Day, r.Part))
            .Select(g => new OccupancyCellView(g.Key.Day, g.Key.Part, g.Sum(r => r.Places), g.Sum(r => r.Capacity), g.Any(r => r.Pressure)))
            .OrderBy(c => c.Day).ThenBy(c => c.Part switch { "morning" => 0, "noon" => 1, _ => 2 })];
    }

    /// <summary>
    /// The full class of the next 7 days with the longest line (4 or more waiting), and the first quarter hour that
    /// day after it when its instructor is free and a room big enough is empty for the class's length.
    /// </summary>
    private async Task<SuggestionView?> PressureAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        Guid sessionId;
        string className;
        DateTimeOffset startsAt;
        DateTimeOffset endsAt;
        Guid? instructor;
        string? instructorName;
        int capacity;
        int waiting;
        await using (var command = unitOfWork.Command(
            """
            SELECT s.id, ct.name, s.starts_at, s.ends_at, s.instructor_membership_id, ip.display_name, s.capacity, w.waiting
            FROM scheduling.sessions s
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            LEFT JOIN people.people ip ON ip.organization_id = s.organization_id AND ip.membership_id = s.instructor_membership_id
            JOIN LATERAL (SELECT count(*)::int AS waiting FROM scheduling.bookings b
                          WHERE b.organization_id = s.organization_id AND b.session_id = s.id AND b.status = 'waitlisted') w ON true
            WHERE s.organization_id = $1 AND s.status = 'scheduled' AND s.starts_at > $2 AND s.starts_at < $2 + interval '7 days'
              AND s.booked_count >= s.capacity AND w.waiting >= $3
            ORDER BY w.waiting DESC, s.starts_at
            LIMIT 1
            """,
            organizationId, now, WaitlistPressure))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            sessionId = reader.GetGuid(0);
            className = reader.GetString(1);
            startsAt = await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken);
            endsAt = await reader.GetFieldValueAsync<DateTimeOffset>(3, cancellationToken);
            instructor = await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetGuid(4);
            instructorName = await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5);
            capacity = reader.GetInt32(6);
            waiting = reader.GetInt32(7);
        }

        var people = new List<PersonRefView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT p.id, p.display_name FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = $1 AND b.session_id = $2 AND b.status = 'waitlisted'
            ORDER BY b.waitlist_position LIMIT 3
            """,
            organizationId, sessionId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                people.Add(new PersonRefView(reader.GetGuid(0), reader.GetString(1)));
            }
        }

        var length = endsAt - startsAt;
        SuggestedSlotView? slot = null;
        var candidate = new DateTimeOffset(endsAt.UtcTicks - (endsAt.UtcTicks % TimeSpan.TicksPerMinute), TimeSpan.Zero).AddMinutes(15);
        candidate = candidate.AddMinutes(-(candidate.Minute % 15));
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var localDay = TimeZoneInfo.ConvertTime(startsAt, zone).Date;
        for (var i = 0; i < 24 && TimeZoneInfo.ConvertTime(candidate.Add(length), zone).Date == localDay && TimeZoneInfo.ConvertTime(candidate.Add(length), zone).Hour < 22; i++, candidate = candidate.AddMinutes(15))
        {
            await using var free = unitOfWork.Command(
                """
                SELECT r.id, r.name FROM scheduling.rooms r
                WHERE r.organization_id = $1 AND r.status = 'active' AND r.default_capacity >= $5
                  AND NOT EXISTS (SELECT 1 FROM scheduling.sessions o WHERE o.organization_id = r.organization_id AND o.room_id = r.id
                                  AND o.status = 'scheduled' AND o.starts_at < $3 AND o.ends_at > $2)
                  AND ($4::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM scheduling.sessions o WHERE o.organization_id = r.organization_id
                                  AND o.instructor_membership_id = $4 AND o.status = 'scheduled' AND o.starts_at < $3 AND o.ends_at > $2))
                ORDER BY r.default_capacity, r.name
                LIMIT 1
                """,
                organizationId, candidate, candidate.Add(length), instructor, capacity);
            await using var reader = await free.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                slot = new SuggestedSlotView(candidate, reader.GetGuid(0), reader.GetString(1));
                break;
            }
        }

        return new SuggestionView("waitlist_pressure", waiting, people, null, sessionId, className, startsAt, instructor, instructorName, slot);
    }

    private static string EscapeLike(string text) => text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal);

    private DateOnly Today(TimeZoneInfo zone) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);

    private static void Require(TenantContext tenant, string permission)
    {
        if (!tenant.Has(permission))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You do not have permission to do this.");
        }
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
