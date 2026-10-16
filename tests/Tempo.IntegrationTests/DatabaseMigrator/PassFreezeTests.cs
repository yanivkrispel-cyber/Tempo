using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Freezing a period membership (docs/29 section 16.4) on PostgreSQL 18: validity moves out by the frozen days,
/// nothing books inside them, punch cards and overlaps are refused, a freeze that has not started can be removed.
/// </summary>
public sealed class PassFreezeTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static readonly TimeZoneInfo Israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");

    [Fact]
    public async Task Freeze_ExtendsValidity_AndBlocksBookingInsideThePeriod()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var (dana, membership) = await MemberWithMembershipAsync(s);
        var today = Today();

        var frozen = await s.Passes.FreezeAsync(s.Owner, membership, new NewFreeze(today.AddDays(3), today.AddDays(9)), CancellationToken.None);

        frozen.EndsOn.Should().Be(today.AddDays(29 + 7), "seven frozen days move the end out");
        frozen.Freezes.Should().ContainSingle().Which.Should().BeEquivalentTo(new { StartsOn = today.AddDays(3), EndsOn = today.AddDays(9) });
        var inside = await SessionAsync(db, s, TimeSpan.FromDays(5));
        var after = await SessionAsync(db, s, TimeSpan.FromDays(12));
        var blocked = () => s.Bookings.BookAsync(s.Owner, inside, dana, CancellationToken.None);
        (await blocked.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("booking.no_valid_pass");
        (await s.Bookings.BookAsync(s.Owner, after, dana, CancellationToken.None)).Status.Should().Be("booked");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'pass.frozen' AND target_id = $1 AND (data ->> 'days')::int = 7", membership)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE person_id = $1 AND kind = 'pass.frozen'", dana)).Should().Be(1L);
    }

    [Fact]
    public async Task Freeze_APunchCard_IsRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = (await s.People.CreateAsync(s.Owner, new NewPerson("Dana", null, null, null, "dana@example.com", null), CancellationToken.None)).Person.Id;
        var card = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, null), CancellationToken.None);
        var pass = await s.Passes.GrantAsync(s.Owner, dana, new NewPass(card.Id, null, null), CancellationToken.None);

        var freeze = () => s.Passes.FreezeAsync(s.Owner, pass.Id, new NewFreeze(Today(), Today().AddDays(6)), CancellationToken.None);

        (await freeze.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("pass.not_freezable");
    }

    [Fact]
    public async Task Freeze_Overlapping_IsRefused_AndUnfreezeBeforeStart_RestoresValidity()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var (_, membership) = await MemberWithMembershipAsync(s);
        var today = Today();
        var frozen = await s.Passes.FreezeAsync(s.Owner, membership, new NewFreeze(today.AddDays(3), today.AddDays(9)), CancellationToken.None);

        var overlapping = () => s.Passes.FreezeAsync(s.Owner, membership, new NewFreeze(today.AddDays(9), today.AddDays(10)), CancellationToken.None);
        (await overlapping.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("pass.freeze_overlap");

        var unfrozen = await s.Passes.UnfreezeAsync(s.Owner, membership, frozen.Freezes![0].Id, CancellationToken.None);

        unfrozen.EndsOn.Should().Be(today.AddDays(29), "the end comes back");
        unfrozen.Freezes.Should().BeEmpty();
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'pass.unfrozen' AND target_id = $1", membership)).Should().Be(1L);
    }

    [Fact]
    public async Task Unfreeze_AfterItStarted_IsRefused_AndTooLongOrPastFreezes_AreInvalid()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var (_, membership) = await MemberWithMembershipAsync(s);
        var today = Today();
        var frozen = await s.Passes.FreezeAsync(s.Owner, membership, new NewFreeze(today, today.AddDays(2)), CancellationToken.None);

        var started = () => s.Passes.UnfreezeAsync(s.Owner, membership, frozen.Freezes![0].Id, CancellationToken.None);
        (await started.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("pass.freeze_started");

        var tooLong = () => s.Passes.FreezeAsync(s.Owner, membership, new NewFreeze(today.AddDays(10), today.AddDays(100)), CancellationToken.None);
        (await tooLong.Should().ThrowAsync<DomainRuleViolationException>()).Which.Kind.Should().Be(ViolationKind.Validation);
        var past = () => s.Passes.FreezeAsync(s.Owner, membership, new NewFreeze(today.AddDays(-1), today.AddDays(1)), CancellationToken.None);
        (await past.Should().ThrowAsync<DomainRuleViolationException>()).Which.Kind.Should().Be(ViolationKind.Validation);
    }

    private sealed record Studio(TenantContext Owner, PeopleService People, PassService Passes, BookingService Bookings, Guid ClassType);

    [Fact]
    public async Task TheMember_SeesFrozenUntilOnTheTimetable_AndInTheRefusal()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var (member, person) = await MemberWithLoginAsync(db, s);
        var product = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("membership", "מנוי חודשי", null, 30, null, null, null), CancellationToken.None);
        var pass = await s.Passes.GrantAsync(s.Owner, person, new NewPass(product.Id, null, null), CancellationToken.None);
        var today = Today();
        await s.Passes.FreezeAsync(s.Owner, pass.Id, new NewFreeze(today.AddDays(3), today.AddDays(9)), CancellationToken.None);
        var inside = await SessionAsync(db, s, TimeSpan.FromDays(5));
        var after = await SessionAsync(db, s, TimeSpan.FromDays(12));

        var timetable = await new TimetableService(db, TimeProvider.System).ListSessionsAsync(member, new SessionQuery(today, today.AddDays(20), null, null), CancellationToken.None);

        timetable.Single(x => x.Id == inside).Should().BeEquivalentTo(new { PassPreview = (PassSummaryView?)null, FrozenUntil = today.AddDays(9) });
        timetable.Single(x => x.Id == after).FrozenUntil.Should().BeNull();
        timetable.Single(x => x.Id == after).PassPreview!.Name.Should().Be("מנוי חודשי");
        var refused = () => s.Bookings.BookAsync(member, inside, null, CancellationToken.None);
        var problem = (await refused.Should().ThrowAsync<DomainRuleViolationException>()).Which;
        problem.Code.Should().Be("booking.no_valid_pass");
        problem.Extensions!["frozenUntil"].Should().Be(today.AddDays(9));
    }

    /// <summary>A member with a login: an account, a client membership, and the people row linked to it.</summary>
    private static async Task<(TenantContext Member, Guid PersonId)> MemberWithLoginAsync(MigratedDatabase db, Studio s)
    {
        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'member@example.com', true, now(), now(), now())",
            account);
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', 'active', now(), now())",
            s.Owner.OrganizationId, membershipId, account);
        var person = (await s.People.CreateAsync(s.Owner, new NewPerson("Member", null, null, null, "member@example.com", null), CancellationToken.None)).Person.Id;
        await db.AsMasterAsync("UPDATE people.people SET user_account_id = $1, membership_id = $2 WHERE id = $3", account, membershipId, person);
        return (new TenantContext(s.Owner.OrganizationId, account, membershipId, MembershipRole.Client, OrganizationStatus.Active, "test"), person);
    }

    private static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Israel).DateTime);

    private static async Task<Studio> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        var owner = new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
        var classType = await new TimetableService(db, TimeProvider.System).CreateClassTypeAsync(owner, new NewClassType("פילאטיס", "pilates", "rose", 50, null), CancellationToken.None);
        return new Studio(owner, new PeopleService(db), new PassService(db, TimeProvider.System), new BookingService(db, TimeProvider.System), classType.Id);
    }

    /// <summary>A person with a 30-day membership granted today: it ends 29 days from now.</summary>
    private static async Task<(Guid PersonId, Guid PassId)> MemberWithMembershipAsync(Studio s)
    {
        var person = (await s.People.CreateAsync(s.Owner, new NewPerson("Dana", null, null, null, $"{Guid.NewGuid():N}@example.com", null), CancellationToken.None)).Person.Id;
        var product = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("membership", "מנוי חודשי", null, 30, null, null, null), CancellationToken.None);
        var pass = await s.Passes.GrantAsync(s.Owner, person, new NewPass(product.Id, null, null), CancellationToken.None);
        return (person, pass.Id);
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, Studio s, TimeSpan startsIn)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.Add(startsIn);
        var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(startsAt, Israel).DateTime);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 8, 'scheduled', now(), now())",
            s.Owner.OrganizationId, id, localDate, s.ClassType, startsAt, startsAt.AddMinutes(50));
        return id;
    }
}
