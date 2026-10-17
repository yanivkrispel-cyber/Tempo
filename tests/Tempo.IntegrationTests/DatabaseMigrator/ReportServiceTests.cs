using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Owner reports (docs/32) on PostgreSQL 18: week edges in the studio's time zone (Asia/Jerusalem), what counts as a
/// place, the previous period, members, RLS between studios, the permissions and the two lists. Every name is
/// fictional.
/// </summary>
public sealed class ReportServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    // Saturday 2026-10-17 13:00 in Israel (summer time, +03:00).
    private static readonly DateTimeOffset Now = new(2026, 10, 17, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly From = new(2026, 10, 4);
    private static readonly DateOnly To = new(2026, 10, 17);

    [Fact]
    public async Task Summary_CountsPlacesByWeek_InTheStudiosTimeZone()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var pilates = await ClassTypeAsync(db, studio, "פילאטיס");
        var yoga = await ClassTypeAsync(db, studio, "יוגה");

        // Saturday 10-10 at 23:30 local (20:30 UTC) closes the first week; its local date decides the week.
        var saturdayLate = await SessionAsync(db, studio, pilates, new DateOnly(2026, 10, 10), new DateTimeOffset(2026, 10, 10, 20, 30, 0, TimeSpan.Zero), 8);
        await BookAsync(db, studio, saturdayLate, "attended");
        await BookAsync(db, studio, saturdayLate, "attended");
        await BookAsync(db, studio, saturdayLate, "no_show");
        await BookAsync(db, studio, saturdayLate, "booked");
        await BookAsync(db, studio, saturdayLate, "cancelled", lateCancel: true);
        await BookAsync(db, studio, saturdayLate, "cancelled");
        await BookAsync(db, studio, saturdayLate, "waitlisted");

        // Sunday 10-11 at 00:15 local (Saturday 21:15 UTC) opens the next week.
        var sundayEarly = await SessionAsync(db, studio, yoga, new DateOnly(2026, 10, 11), new DateTimeOffset(2026, 10, 10, 21, 15, 0, TimeSpan.Zero), 10);
        await BookAsync(db, studio, sundayEarly, "attended");

        // Neither a cancelled session nor one that hasn't started yet was held.
        var cancelled = await SessionAsync(db, studio, yoga, new DateOnly(2026, 10, 12), new DateTimeOffset(2026, 10, 12, 15, 0, 0, TimeSpan.Zero), 5, "cancelled");
        await BookAsync(db, studio, cancelled, "cancelled");
        var tonight = await SessionAsync(db, studio, yoga, To, Now.AddHours(8), 6);
        await BookAsync(db, studio, tonight, "booked");

        // The period before: 09-20 to 10-03.
        var before = await SessionAsync(db, studio, pilates, new DateOnly(2026, 10, 3), new DateTimeOffset(2026, 10, 3, 6, 0, 0, TimeSpan.Zero), 4);
        await BookAsync(db, studio, before, "attended");

        var summary = await Reports(db).GetSummaryAsync(studio.Owner, From, To, CancellationToken.None);

        summary.TimeZone.Should().Be("Asia/Jerusalem");
        summary.Weeks.Select(w => w.WeekStart).Should().Equal(new DateOnly(2026, 10, 4), new DateOnly(2026, 10, 11));
        summary.Weeks[0].Figures.Should().Be(new ReportFigures(SessionsHeld: 1, Capacity: 8, PlacesBooked: 4, Attended: 2, NoShow: 1, LateCancellations: 1));
        summary.Weeks[0].Figures.FillRate.Should().Be(0.25m);
        summary.Weeks[1].Figures.Should().Be(new ReportFigures(1, 10, 1, 1, 0, 0));
        summary.Weeks[1].Figures.FillRate.Should().Be(0.1m);

        summary.Totals.Figures.Should().Be(new ReportFigures(2, 18, 5, 3, 1, 1));
        summary.Totals.Figures.FillRate.Should().Be(0.167m);
        summary.ClassTypes.Select(c => c.Name).Should().Equal("פילאטיס", "יוגה");
        summary.ClassTypes[0].Figures.Attended.Should().Be(2);

        summary.Previous.From.Should().Be(new DateOnly(2026, 9, 20));
        summary.Previous.To.Should().Be(new DateOnly(2026, 10, 3));
        summary.Previous.Figures.Should().Be(new ReportFigures(1, 4, 1, 1, 0, 0));
    }

    [Fact]
    public async Task AnEmptyWeek_IsThere_WithNoFillRate()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");

        var summary = await Reports(db).GetSummaryAsync(studio.Owner, From, To, CancellationToken.None);

        summary.Weeks.Should().HaveCount(2).And.OnlyContain(w => w.Figures == ReportFigures.Empty && w.Figures.FillRate == null);
        summary.ClassTypes.Should().BeEmpty();
    }

    [Fact]
    public async Task Members_AreActiveByAttendance_AndNewByTheirLocalJoinDay()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var pilates = await ClassTypeAsync(db, studio, "פילאטיס");
        var session = await SessionAsync(db, studio, pilates, new DateOnly(2026, 10, 6), new DateTimeOffset(2026, 10, 6, 6, 0, 0, TimeSpan.Zero), 8);
        var regular = await PersonAsync(db, studio, "רגיל");
        await BookAsync(db, studio, session, "attended", regular);
        await BookAsync(db, studio, session, "no_show");

        // 10-03 22:30 UTC is 10-04 01:30 in Israel: in the period. 10-17 21:30 UTC is 10-18 local: after it.
        await PersonAsync(db, studio, "חדש", new DateTimeOffset(2026, 10, 3, 22, 30, 0, TimeSpan.Zero));
        await PersonAsync(db, studio, "מאוחר", new DateTimeOffset(2026, 10, 17, 21, 30, 0, TimeSpan.Zero));
        var staff = await PersonAsync(db, studio, "מדריכה", new DateTimeOffset(2026, 10, 8, 9, 0, 0, TimeSpan.Zero));
        await LinkMembershipAsync(db, studio, staff, "staff");
        await BookAsync(db, studio, session, "attended", staff);
        var merged = await PersonAsync(db, studio, "כפילות", new DateTimeOffset(2026, 10, 8, 9, 0, 0, TimeSpan.Zero));
        await db.AsMasterAsync("UPDATE people.people SET status = 'merged', merged_into_id = $1 WHERE id = $2", regular, merged);

        var totals = (await Reports(db).GetSummaryAsync(studio.Owner, From, To, CancellationToken.None)).Totals;

        // The instructor took the class, but staff are not members.
        totals.ActiveMembers.Should().Be(1);

        // The owner's own record (created today, real time) is staff, not a member.
        totals.NewMembers.Should().Be(1);
    }

    [Fact]
    public async Task AnotherStudiosBookings_NeverCount()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var other = await StudioAsync(db, "other");
        var otherType = await ClassTypeAsync(db, other, "אחר");
        var otherSession = await SessionAsync(db, other, otherType, new DateOnly(2026, 10, 6), new DateTimeOffset(2026, 10, 6, 6, 0, 0, TimeSpan.Zero), 8);
        await BookAsync(db, other, otherSession, "attended");
        await PersonAsync(db, other, "שכן", new DateTimeOffset(2026, 10, 6, 9, 0, 0, TimeSpan.Zero));

        var mine = await Reports(db).GetSummaryAsync(studio.Owner, From, To, CancellationToken.None);
        var theirs = await Reports(db).GetSummaryAsync(other.Owner, From, To, CancellationToken.None);

        mine.Totals.Figures.Should().Be(ReportFigures.Empty);
        mine.Totals.ActiveMembers.Should().Be(0);
        mine.Totals.NewMembers.Should().Be(0);
        theirs.Totals.Figures.Attended.Should().Be(1);
    }

    [Fact]
    public async Task APeriodOver92Days_Is400()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");

        var read = () => Reports(db).GetSummaryAsync(studio.Owner, new DateOnly(2026, 7, 1), new DateOnly(2026, 10, 1), CancellationToken.None);

        (await read.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("report.period_too_long");
    }

    [Fact]
    public async Task WithoutReportsView_EveryReportIs403()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var staff = studio.Owner with { Role = MembershipRole.Staff, Permissions = SystemRoles.Staff.Permissions };
        var reports = Reports(db);

        (await FluentActions.Awaiting(() => reports.GetSummaryAsync(staff, null, null, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>())
            .Which.Kind.Should().Be(ViolationKind.Forbidden);
        (await FluentActions.Awaiting(() => reports.ListPassesEndingAsync(staff, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>())
            .Which.Kind.Should().Be(ViolationKind.Forbidden);
        (await FluentActions.Awaiting(() => reports.ListMembersAtRiskAsync(staff, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>())
            .Which.Kind.Should().Be(ViolationKind.Forbidden);
    }

    [Fact]
    public async Task WithoutPeopleView_TheListsAre403_ButTheSummaryIsNot()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var reportsOnly = studio.Owner with
        {
            Role = MembershipRole.Staff,
            Permissions = new HashSet<string> { Permissions.OrganizationView, Permissions.ReportsView }
        };
        var reports = Reports(db);

        (await reports.GetSummaryAsync(reportsOnly, From, To, CancellationToken.None)).Weeks.Should().HaveCount(2);
        (await FluentActions.Awaiting(() => reports.ListPassesEndingAsync(reportsOnly, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>())
            .Which.Code.Should().Be("permission.denied");
        (await FluentActions.Awaiting(() => reports.ListMembersAtRiskAsync(reportsOnly, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>())
            .Which.Code.Should().Be("permission.denied");
    }

    [Fact]
    public async Task ReportsView_IsSeededForOwnerAndAdminOnly()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);

        var roles = await db.AsMasterAsync(
            "SELECT string_agg(r.key, ',' ORDER BY r.key) FROM authz.role_permissions p JOIN authz.roles r ON r.id = p.role_id WHERE p.permission_key = 'reports.view'");

        roles.Should().Be("admin,owner");
    }

    [Fact]
    public async Task PassesEnding_ListsSoonAndLastEntry_NotRenewedOrUsedUp()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var today = To;
        var card = await ProductAsync(db, studio, "כרטיסייה 10", "punch_card", 10);
        var monthly = await ProductAsync(db, studio, "מנוי חודשי", "membership", null);

        var ending = await PersonAsync(db, studio, "נגמר בקרוב");
        await PassAsync(db, studio, ending, monthly, today.AddDays(-20), today.AddDays(10));
        var lastEntry = await PersonAsync(db, studio, "כניסה אחרונה");
        await PassAsync(db, studio, lastEntry, card, today.AddDays(-20), today.AddDays(60), entries: 10, used: 9);
        var renewed = await PersonAsync(db, studio, "חידש");
        await PassAsync(db, studio, renewed, monthly, today.AddDays(-20), today.AddDays(5));
        await PassAsync(db, studio, renewed, monthly, today.AddDays(6), today.AddDays(36));
        var usedUp = await PersonAsync(db, studio, "נוצל");
        await PassAsync(db, studio, usedUp, card, today.AddDays(-20), today.AddDays(5), entries: 10, used: 10);
        var later = await PersonAsync(db, studio, "רחוק");
        await PassAsync(db, studio, later, monthly, today.AddDays(-20), today.AddDays(15));

        var list = await Reports(db).ListPassesEndingAsync(studio.Owner, CancellationToken.None);

        list.Today.Should().Be(today);
        list.Truncated.Should().BeFalse();
        list.Items.Select(p => (p.PersonId, p.Reason, p.EntriesLeft)).Should().Equal(
            (ending, "ends_soon", (int?)null),
            (lastEntry, "last_entry", (int?)1));
    }

    [Fact]
    public async Task MembersAtRisk_HaveAValidPass_AndNoVisitFor30Days()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var today = To;
        var monthly = await ProductAsync(db, studio, "מנוי שנתי", "membership", null);
        var pilates = await ClassTypeAsync(db, studio, "פילאטיס");
        var oldClass = await SessionAsync(db, studio, pilates, today.AddDays(-35), Now.AddDays(-35), 8);
        var recentClass = await SessionAsync(db, studio, pilates, today.AddDays(-10), Now.AddDays(-10), 8);

        var away = await PersonAsync(db, studio, "נעדרת");
        await PassAsync(db, studio, away, monthly, today.AddDays(-60), today.AddDays(300));
        await BookAsync(db, studio, oldClass, "attended", away);
        var never = await PersonAsync(db, studio, "לא הגיע");
        await PassAsync(db, studio, never, monthly, today.AddDays(-40), today.AddDays(300));
        var regular = await PersonAsync(db, studio, "קבועה");
        await PassAsync(db, studio, regular, monthly, today.AddDays(-60), today.AddDays(300));
        await BookAsync(db, studio, recentClass, "attended", regular);
        var newcomer = await PersonAsync(db, studio, "חדשה");
        await PassAsync(db, studio, newcomer, monthly, today.AddDays(-5), today.AddDays(300));
        var frozen = await PersonAsync(db, studio, "בהקפאה");
        var frozenPass = await PassAsync(db, studio, frozen, monthly, today.AddDays(-60), today.AddDays(300));
        await db.AsMasterAsync(
            "INSERT INTO scheduling.pass_freezes (organization_id, id, pass_id, starts_on, ends_on, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
            studio.Owner.OrganizationId, Guid.CreateVersion7(), frozenPass, today.AddDays(-7), today.AddDays(7), studio.Owner.MembershipId);
        var noPass = await PersonAsync(db, studio, "בלי מנוי");
        await BookAsync(db, studio, oldClass, "attended", noPass);

        var list = await Reports(db).ListMembersAtRiskAsync(studio.Owner, CancellationToken.None);

        list.Items.Select(m => (m.PersonId, m.LastAttendedOn)).Should().Equal(
            (never, (DateOnly?)null),
            (away, (DateOnly?)today.AddDays(-35)));
        list.Items[1].PassEndsOn.Should().Be(today.AddDays(300));
    }

    [Fact]
    public async Task ALongList_IsCutAt50_AndSaysSo()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "main");
        var monthly = await ProductAsync(db, studio, "מנוי", "membership", null);
        for (var i = 0; i < 51; i++)
        {
            await PassAsync(db, studio, await PersonAsync(db, studio, $"מתאמן {i}"), monthly, To.AddDays(-20), To.AddDays(3));
        }

        var list = await Reports(db).ListPassesEndingAsync(studio.Owner, CancellationToken.None);

        list.Items.Should().HaveCount(50);
        list.Truncated.Should().BeTrue();
    }

    private sealed record Studio(TenantContext Owner);

    private static ReportService Reports(MigratedDatabase db) => new(db, new FixedClock(Now));

    private static async Task<Studio> StudioAsync(MigratedDatabase db, string slug)
    {
        var ownerAccount = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            ownerAccount, $"owner-{slug}@example.com");
        var organization = await new OrganizationService(db).CreateAsync(new AccountSnapshot(ownerAccount, AccountStatus.Active, true), new NewOrganization("Main", $"studio-{slug}", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(ownerAccount, organization.Id, CancellationToken.None))!;
        return new Studio(new TenantContext(organization.Id, ownerAccount, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test"));
    }

    private static async Task<Guid> ClassTypeAsync(MigratedDatabase db, Studio studio, string name) =>
        (await new TimetableService(db, TimeProvider.System).CreateClassTypeAsync(studio.Owner, new NewClassType(name, "pilates", "rose", 50, null), CancellationToken.None)).Id;

    private static async Task<Guid> SessionAsync(MigratedDatabase db, Studio studio, Guid classType, DateOnly localDate, DateTimeOffset startsAt, int capacity, string status = "scheduled")
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())",
            studio.Owner.OrganizationId, id, localDate, classType, startsAt, startsAt.AddMinutes(50), capacity, status);
        return id;
    }

    /// <summary>A fictional person record with no login, joined on <paramref name="createdAt"/> (default: long ago).</summary>
    private static async Task<Guid> PersonAsync(MigratedDatabase db, Studio studio, string name, DateTimeOffset? createdAt = null)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO people.people (organization_id, id, display_name, status, source, created_at, updated_at) VALUES ($1, $2, $3, 'active', 'staff_created', $4, $4)",
            studio.Owner.OrganizationId, id, name, createdAt ?? new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero));
        return id;
    }

    private static async Task LinkMembershipAsync(MigratedDatabase db, Studio studio, Guid person, string role)
    {
        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account, $"{role}-{account:N}@example.com");
        var membership = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studio.Owner.OrganizationId, membership, account, role);
        await db.AsMasterAsync("UPDATE people.people SET user_account_id = $1, membership_id = $2 WHERE id = $3", account, membership, person);
    }

    /// <summary>A place on the session for <paramref name="person"/>, or for a new person when none is given.</summary>
    private static async Task BookAsync(MigratedDatabase db, Studio studio, Guid session, string status, Guid? person = null, bool lateCancel = false)
    {
        var who = person ?? await PersonAsync(db, studio, "מתאמנת");
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, waitlist_position, late_cancel, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())",
            studio.Owner.OrganizationId, Guid.CreateVersion7(), session, who, status, status == "waitlisted" ? 1 : null, lateCancel, studio.Owner.MembershipId);
    }

    private static async Task<Guid> ProductAsync(MigratedDatabase db, Studio studio, string name, string kind, int? entries)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.pass_products (organization_id, id, kind, name, entries, valid_days, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 365, 'active', now(), now())",
            studio.Owner.OrganizationId, id, kind, name, entries);
        return id;
    }

    private static async Task<Guid> PassAsync(MigratedDatabase db, Studio studio, Guid person, Guid product, DateOnly startsOn, DateOnly endsOn, int? entries = null, int used = 0)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, entries_used, status, granted_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, now(), now())",
            studio.Owner.OrganizationId, id, person, product, startsOn, endsOn, entries, used, studio.Owner.MembershipId);
        return id;
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
