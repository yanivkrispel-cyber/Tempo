using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>Merging two people moves their bookings, passes and inbox (docs/29 section 7).</summary>
public sealed class MergeSchedulingTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task AMerge_MovesBookingsAndPasses_AndSettlesADoubleBooking()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var passes = new PassService(db, TimeProvider.System);
        var bookings = new BookingService(db, TimeProvider.System);
        var timetable = new TimetableService(db, TimeProvider.System);
        var classType = await timetable.CreateClassTypeAsync(owner, new NewClassType("Reformer", "pilates", "rose", 50, null), CancellationToken.None);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "Card", 10, 90, null, null, null), CancellationToken.None);

        var keep = (await people.CreateAsync(owner, new NewPerson("Noa Levi", null, null, null, null, "050-2345678"), CancellationToken.None)).Person.Id;
        var drop = (await people.CreateAsync(owner, new NewPerson("Noa L", null, null, null, null, "0502345678"), CancellationToken.None)).Person.Id;
        await passes.GrantAsync(owner, keep, new NewPass(card.Id, null, null), CancellationToken.None);
        var dropCard = await passes.GrantAsync(owner, drop, new NewPass(card.Id, null, null), CancellationToken.None);

        var shared = await SessionAsync(db, owner, classType.Id, TimeSpan.FromDays(1));
        var onlyDropped = await SessionAsync(db, owner, classType.Id, TimeSpan.FromDays(2));
        await bookings.BookAsync(owner, shared, keep, CancellationToken.None);
        var doubled = await bookings.BookAsync(owner, shared, drop, CancellationToken.None);
        var moved = await bookings.BookAsync(owner, onlyDropped, drop, CancellationToken.None);

        var pair = (Guid)(await db.AsMasterAsync("SELECT id FROM people.duplicate_candidates WHERE organization_id = $1", owner.OrganizationId))!;
        await new PersonLifecycleService(db, TimeProvider.System).ResolveAsync(owner, pair, "merge", keep, CancellationToken.None);

        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", doubled.Id)).Should().Be("cancelled");
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", shared)).Should().Be(1);
        (await db.AsMasterAsync("SELECT person_id FROM scheduling.bookings WHERE id = $1", moved.Id)).Should().Be(keep);
        (await db.AsMasterAsync("SELECT person_id FROM scheduling.passes WHERE id = $1", dropCard.Id)).Should().Be(keep);
        (await db.AsMasterAsync("SELECT entries_used FROM scheduling.passes WHERE id = $1", dropCard.Id)).Should().Be(1, "the doubled booking's entry returned");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.bookings WHERE person_id = $1", drop)).Should().Be(0L);
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, TenantContext owner, Guid classType, TimeSpan startsIn)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.Add(startsIn);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 8, 'scheduled', now(), now())",
            owner.OrganizationId, id, DateOnly.FromDateTime(startsAt.UtcDateTime), classType, startsAt, startsAt.AddMinutes(50));
        return id;
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
