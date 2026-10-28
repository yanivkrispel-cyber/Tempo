using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Member progress (docs/31 section 12) on PostgreSQL 18: only attended classes count, by their date in the
/// studio's time zone (Asia/Jerusalem), and the goal is the member's own, set, changed and cleared.
/// </summary>
public sealed class ProgressServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    // 2026-11-01 00:30 in Israel (winter time, +02:00) is still 2026-10-31 22:30 UTC.
    private static readonly DateTimeOffset NovemberFirstJustAfterMidnight = new(2026, 10, 31, 22, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task Visits_FollowTheStudiosMonth_NotUtc()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, member, person) = await StudioWithMemberAsync(db);

        // A class on 2026-10-31 at 23:30 local (21:30 UTC) is October; one on 2026-11-01 at 00:15 local is November.
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 31), new DateTimeOffset(2026, 10, 31, 21, 30, 0, TimeSpan.Zero), "attended");
        await PlaceAsync(db, owner, person, new DateOnly(2026, 11, 1), new DateTimeOffset(2026, 10, 31, 22, 15, 0, TimeSpan.Zero), "attended");

        var progress = await new ProgressService(db, new FixedClock(NovemberFirstJustAfterMidnight)).GetMineAsync(member, CancellationToken.None);

        progress.Month.Should().Be("2026-11");
        progress.TimeZone.Should().Be("Asia/Jerusalem");
        progress.VisitsThisMonth.Should().Be(1);

        // Sunday 11-01 opens a week with a class; Saturday 10-31 closed the week before with one.
        progress.StreakWeeks.Should().Be(2);
        progress.MonthlyGoal.Should().BeNull();
    }

    [Fact]
    public async Task NoShowsAndBookings_DoNotCount()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, member, person) = await StudioWithMemberAsync(db);
        var now = new DateTimeOffset(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 20), now.AddDays(-1), "no_show");
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 13), now.AddDays(-8), "attended");
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 22), now.AddDays(1), "booked");

        var progress = await new ProgressService(db, new FixedClock(now)).GetMineAsync(member, CancellationToken.None);

        progress.VisitsThisMonth.Should().Be(1);

        // This week has only a no-show: it neither breaks last week's streak nor adds to it.
        progress.StreakWeeks.Should().Be(1);
    }

    [Fact]
    public async Task TheGoal_IsSetChangedAndCleared()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, member, _) = await StudioWithMemberAsync(db);
        var progress = new ProgressService(db, TimeProvider.System);

        (await progress.SetMyGoalAsync(member, 12, CancellationToken.None)).MonthlyGoal.Should().Be(12);
        (await progress.SetMyGoalAsync(member, 8, CancellationToken.None)).MonthlyGoal.Should().Be(8);
        (await progress.GetMineAsync(member, CancellationToken.None)).MonthlyGoal.Should().Be(8);
        (await progress.SetMyGoalAsync(member, null, CancellationToken.None)).MonthlyGoal.Should().BeNull();
        (await db.AsMasterAsync("SELECT count(*)::int FROM scheduling.member_goals")).Should().Be(0);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(32)]
    public async Task AGoalOutsideOneTo31_IsRefused(int goal)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, member, _) = await StudioWithMemberAsync(db);

        var set = () => new ProgressService(db, TimeProvider.System).SetMyGoalAsync(member, goal, CancellationToken.None);

        (await set.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("monthlyGoal.invalid");
    }

    [Fact]
    public async Task Erase_DeletesTheGoal()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, member, person) = await StudioWithMemberAsync(db);
        await new ProgressService(db, TimeProvider.System).SetMyGoalAsync(member, 10, CancellationToken.None);

        await new PersonLifecycleService(db, TimeProvider.System).EraseAsync(owner, person, "בקשת מחיקה", CancellationToken.None);

        (await db.AsMasterAsync("SELECT count(*)::int FROM scheduling.member_goals")).Should().Be(0);
    }

    [Fact]
    public async Task AnotherStudiosMember_DoesNotSeeTheGoal()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, member, _) = await StudioWithMemberAsync(db);
        await new ProgressService(db, TimeProvider.System).SetMyGoalAsync(member, 10, CancellationToken.None);
        var (_, otherMember, _) = await StudioWithMemberAsync(db, "other");

        (await new ProgressService(db, TimeProvider.System).GetMineAsync(otherMember, CancellationToken.None)).MonthlyGoal.Should().BeNull();
    }

    [Fact]
    public async Task GetMine_ReadsInTwoStatements()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, member, person) = await StudioWithMemberAsync(db);
        var now = new DateTimeOffset(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 13), now.AddDays(-8), "attended");
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 20), now.AddDays(-1), "attended");
        await PlaceAsync(db, owner, person, new DateOnly(2026, 10, 22), now.AddDays(1), "booked");
        var progress = new ProgressService(db, new FixedClock(now));
        await progress.SetMyGoalAsync(member, 6, CancellationToken.None);

        // What opening and rolling back an empty unit of work costs (the tenant context), so only the reads are pinned.
        var (_, opening) = await QueryCounter.CountAsync(async () =>
        {
            await using var unitOfWork = await UnitOfWork.BeginAsync(db, DatabaseRole.Application, member.UserAccountId, member.OrganizationId, CancellationToken.None);
            return 0;
        });
        var (mine, queries) = await QueryCounter.CountAsync(() => progress.GetMineAsync(member, CancellationToken.None));

        (queries - opening).Should().Be(2, "the person, time zone and goal are one read, and the attended and booked days another (board #537, K2)");
        mine.Month.Should().Be("2026-10");
        mine.TimeZone.Should().Be("Asia/Jerusalem");
        mine.VisitsThisMonth.Should().Be(2);
        mine.MonthlyGoal.Should().Be(6);
        mine.StreakWeeks.Should().Be(2);
        mine.Weeks.Should().NotBeNull();
        var thisWeek = mine.Weeks.Single(w => w.WeekStart == new DateOnly(2026, 10, 18));
        (thisWeek.Attended, thisWeek.Booked).Should().Be((1, 1));
    }

    [Fact]
    public async Task AnArchivedPerson_IsNotFound()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, member, person) = await StudioWithMemberAsync(db);
        await db.AsMasterAsync("UPDATE people.people SET status = 'archived' WHERE id = $1", person);

        var read = () => new ProgressService(db, TimeProvider.System).GetMineAsync(member, CancellationToken.None);

        (await read.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.not_found");
    }

    private static async Task<(TenantContext Owner, TenantContext Member, Guid Person)> StudioWithMemberAsync(MigratedDatabase db, string slug = "main")
    {
        var ownerAccount = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            ownerAccount, $"owner-{slug}@example.com");
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(ownerAccount, AccountStatus.Active, true), new NewOrganization("Main", $"studio-{slug}", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(ownerAccount, studio.Id, CancellationToken.None))!;
        var owner = new TenantContext(studio.Id, ownerAccount, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");

        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account, $"member-{slug}@example.com");
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', 'active', now(), now())",
            studio.Id, membershipId, account);
        var person = (await new PeopleService(db).CreateAsync(owner, new NewPerson("דנה", null, null, null, $"member-{slug}@example.com", null), CancellationToken.None)).Person.Id;
        await db.AsMasterAsync("UPDATE people.people SET user_account_id = $1, membership_id = $2 WHERE id = $3", account, membershipId, person);
        return (owner, new TenantContext(studio.Id, account, membershipId, MembershipRole.Client, OrganizationStatus.Active, "test"), person);
    }

    /// <summary>A session on <paramref name="localDate"/> and the person's place on it, in <paramref name="status"/>.</summary>
    private static async Task PlaceAsync(MigratedDatabase db, TenantContext owner, Guid person, DateOnly localDate, DateTimeOffset startsAt, string status)
    {
        var classType = await new TimetableService(db, TimeProvider.System).CreateClassTypeAsync(owner, new NewClassType($"פילאטיס {localDate:MMdd}", "pilates", "rose", 50, null), CancellationToken.None);
        var session = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 8, 'scheduled', now(), now())",
            owner.OrganizationId, session, localDate, classType.Id, startsAt, startsAt.AddMinutes(50));
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), session, person, status, owner.MembershipId);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
