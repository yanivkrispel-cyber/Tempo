using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>The daily job as the platform role (docs/29 section 11): the horizon moves, waitlists close, twice is safe.</summary>
public sealed class SchedulingDailyJobTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task TheJob_ExtendsTheHorizon_AndClosesStartedWaitlists_Idempotently()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var classType = await timetable.CreateClassTypeAsync(owner, new NewClassType("Yoga", "yoga", "sage", 60, null), CancellationToken.None);
        var template = await timetable.CreateTemplateAsync(owner, new NewTemplate(classType.Id, 3, new TimeOnly(9, 0), null, null, null, 10, null, null), CancellationToken.None);

        // The weekly class was created a week ago: its newest session is a week short of the horizon.
        await db.AsMasterAsync("DELETE FROM scheduling.sessions WHERE template_id = $1 AND local_date > current_date + 49", template.Template.Id);
        var before = Convert.ToInt64(await db.AsMasterAsync("SELECT count(*) FROM scheduling.sessions WHERE template_id = $1", template.Template.Id), System.Globalization.CultureInfo.InvariantCulture);

        // A started class with someone still waiting.
        var started = Guid.CreateVersion7();
        var person = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1", owner.OrganizationId))!;
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, booked_count, status, created_at, updated_at) VALUES ($1, $2, current_date, $3, now() - interval '10 minutes', now() + interval '50 minutes', 1, 0, 'scheduled', now(), now())",
            owner.OrganizationId, started, classType.Id);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, waitlist_position, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'waitlisted', 1, $5, now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), started, person, owner.MembershipId);

        var job = new SchedulingDailyJob(db, TimeProvider.System);
        var first = await job.RunAsync(CancellationToken.None);
        var second = await job.RunAsync(CancellationToken.None);

        first.Sessions.Should().BeGreaterThan(0);
        first.ExpiredWaitlist.Should().Be(1);
        second.Should().Be((0, 0), "running twice changes nothing");
        Convert.ToInt64(await db.AsMasterAsync("SELECT count(*) FROM scheduling.sessions WHERE template_id = $1", template.Template.Id), System.Globalization.CultureInfo.InvariantCulture)
            .Should().Be(before + first.Sessions);
        (await db.AsMasterAsync("SELECT kind FROM notifications.inbox_items WHERE person_id = $1", person)).Should().Be("waitlist.expired");
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }
}
