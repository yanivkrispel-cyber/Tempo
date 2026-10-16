using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>Erasing a person releases their upcoming places and keeps the past ones as history (#191).</summary>
public sealed class EraseSchedulingTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task AnErase_CancelsUpcomingPlaces_PromotesTheWaiter_AndKeepsThePast()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var passes = new PassService(db, TimeProvider.System);
        var bookings = new BookingService(db, TimeProvider.System);
        var timetable = new TimetableService(db, TimeProvider.System);
        var classType = await timetable.CreateClassTypeAsync(owner, new NewClassType("Reformer", "pilates", "rose", 50, null), CancellationToken.None);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "Card", 10, 90, null, null, null), CancellationToken.None);
        var erased = (await people.CreateAsync(owner, new NewPerson("Rina", null, null, null, "rina@example.com", null), CancellationToken.None)).Person.Id;
        var waiter = (await people.CreateAsync(owner, new NewPerson("Dana", null, null, null, "dana@example.com", null), CancellationToken.None)).Person.Id;
        var other = (await people.CreateAsync(owner, new NewPerson("Maya", null, null, null, "maya@example.com", null), CancellationToken.None)).Person.Id;
        var erasedCard = await passes.GrantAsync(owner, erased, new NewPass(card.Id, null, null), CancellationToken.None);
        foreach (var person in new[] { waiter, other })
        {
            await passes.GrantAsync(owner, person, new NewPass(card.Id, null, null), CancellationToken.None);
        }

        // A full class: Rina holds the seat, Dana waits.
        var full = await SessionAsync(db, owner, classType.Id, TimeSpan.FromDays(2));
        await db.AsMasterAsync("UPDATE scheduling.sessions SET capacity = 1 WHERE id = $1", full);
        var seat = await bookings.BookAsync(owner, full, erased, CancellationToken.None);
        var waiting = await bookings.BookAsync(owner, full, waiter, CancellationToken.None);
        waiting.Status.Should().Be("waitlisted");

        // Another full class where Rina waits behind Maya.
        var other1 = await SessionAsync(db, owner, classType.Id, TimeSpan.FromDays(3));
        await db.AsMasterAsync("UPDATE scheduling.sessions SET capacity = 1 WHERE id = $1", other1);
        await bookings.BookAsync(owner, other1, other, CancellationToken.None);
        var erasedWaiting = await bookings.BookAsync(owner, other1, erased, CancellationToken.None);
        erasedWaiting.Status.Should().Be("waitlisted");

        // A class Rina attended: it stays for the counts.
        var past = await SessionAsync(db, owner, classType.Id, TimeSpan.FromDays(1));
        var attended = await bookings.BookAsync(owner, past, erased, CancellationToken.None);
        await db.AsMasterAsync("UPDATE scheduling.sessions SET starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '50 minutes' WHERE id = $1", past);
        await db.AsMasterAsync("UPDATE scheduling.bookings SET status = 'attended' WHERE id = $1", attended.Id);

        await new PersonLifecycleService(db, TimeProvider.System).EraseAsync(owner, erased, "בקשת מחיקה", CancellationToken.None);

        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", seat.Id)).Should().Be("cancelled");
        (await db.AsMasterAsync("SELECT late_cancel FROM scheduling.bookings WHERE id = $1", seat.Id)).Should().Be(false);
        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", waiting.Id)).Should().Be("booked", "the seat the erase freed goes to the waitlist");
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", full)).Should().Be(1);
        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", erasedWaiting.Id)).Should().Be("cancelled", "an erased person keeps no waitlist spot");
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", other1)).Should().Be(1);
        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", attended.Id)).Should().Be("attended", "past attendance stays for the counts");
        (await db.AsMasterAsync("SELECT entries_used FROM scheduling.passes WHERE id = $1", erasedCard.Id)).Should().Be(1, "only the attended class keeps its entry");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'booking.cancelled' AND target_id IN ($1, $2) AND data->>'reason' = 'person_erased'", seat.Id, erasedWaiting.Id)).Should().Be(2L);
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
