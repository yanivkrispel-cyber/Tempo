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
/// Who may read a roster (docs/29 section 6.4, #124): staff by permission, the instructor only while still an
/// active staff member, and an unknown or foreign session id answers 404 for everyone.
/// </summary>
public sealed class ClassServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Roster_OfAnUnknownSession_IsNotFound_ForStaffToo()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, _) = await StudioAsync(db);
        var classes = new BookingService(db, TimeProvider.System);

        var roster = () => classes.RosterAsync(owner, Guid.CreateVersion7(), CancellationToken.None);

        (await roster.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("session.not_found");
    }

    [Fact]
    public async Task Roster_IsOpenToTheInstructor_OnlyWhileTheyAreActiveStaff()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var instructor = await MemberAsync(db, studioId, "instructor@example.com", MembershipRole.Staff);
        var session = await SessionAsync(db, owner, instructor.MembershipId);
        var classes = new BookingService(db, TimeProvider.System);
        // The instructor rule, not the staff permission, is what is under test.
        var asInstructor = instructor with { Permissions = new HashSet<string> { Permissions.ScheduleView } };

        (await classes.RosterAsync(asInstructor, session, CancellationToken.None)).Session.Id.Should().Be(session);

        await new MemberService(db, new AccountProfiles(db)).UpdateAsync(owner, instructor.MembershipId, MembershipRole.Client, null, null, CancellationToken.None);
        var demoted = asInstructor with { Role = MembershipRole.Client };
        var roster = () => classes.RosterAsync(demoted, session, CancellationToken.None);
        (await roster.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");

        await db.AsMasterAsync("UPDATE organizations.memberships SET role = 'staff', status = 'suspended' WHERE id = $1", instructor.MembershipId);
        (await roster.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
    }

    private static async Task<(TenantContext Owner, Guid StudioId)> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return (new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test"), studio.Id);
    }

    private static async Task<TenantContext> MemberAsync(MigratedDatabase db, Guid studioId, string email, MembershipRole role)
    {
        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account, email);
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studioId, membershipId, account, StoredValue.Of(role));
        return new TenantContext(studioId, account, membershipId, role, OrganizationStatus.Active, "test");
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, TenantContext owner, Guid instructorMembershipId)
    {
        var classType = await new TimetableService(db, TimeProvider.System).CreateClassTypeAsync(owner, new NewClassType("יוגה", "yoga", "sage", 60, null), CancellationToken.None);
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.AddDays(1);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, instructor_membership_id, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 10, 'scheduled', now(), now())",
            owner.OrganizationId, id, DateOnly.FromDateTime(startsAt.UtcDateTime), classType.Id, startsAt, startsAt.AddMinutes(60), instructorMembershipId);
        return id;
    }
}
