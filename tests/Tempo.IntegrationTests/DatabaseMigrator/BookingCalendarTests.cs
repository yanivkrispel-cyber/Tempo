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

/// <summary>"Add to calendar" (docs/29 section 16.3) on PostgreSQL 18: the caller's own booked place only.</summary>
public sealed class BookingCalendarTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Calendar_ForMyOwnBooking_HasTheClassStudioAndRoom()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, bookings, classType, room) = await StudioAsync(db);
        var (member, person) = await MemberWithCardAsync(db, owner, "dana@example.com");
        var session = await SessionAsync(db, owner, classType, room);
        var booking = await bookings.BookAsync(owner, session, person, CancellationToken.None);

        var file = await bookings.CalendarAsync(member, booking.Id, CancellationToken.None);

        file.FileName.Should().MatchRegex(@"^tempo-\d{4}-\d{2}-\d{2}\.ics$");
        file.Content.Should().Contain($"UID:{booking.Id}@tempo\r\n")
            .And.Contain("SUMMARY:פילאטיס מכשירים\r\n")
            .And.Contain("LOCATION:Main\\, חדר המכשירים\r\n")
            .And.Contain("DESCRIPTION:שיעור פילאטיס מכשירים בסטודיו Main\r\n");
    }

    [Fact]
    public async Task Calendar_ForSomeoneElsesBooking_OrAWaitlistPlace_IsNotFound()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, bookings, classType, room) = await StudioAsync(db);
        var (dana, danaPerson) = await MemberWithCardAsync(db, owner, "dana@example.com");
        var (noa, noaPerson) = await MemberWithCardAsync(db, owner, "noa@example.com");
        var session = await SessionAsync(db, owner, classType, room, capacity: 1);
        var danas = await bookings.BookAsync(owner, session, danaPerson, CancellationToken.None);
        var noas = await bookings.BookAsync(owner, session, noaPerson, CancellationToken.None);
        noas.Status.Should().Be("waitlisted");

        var someoneElses = () => bookings.CalendarAsync(noa, danas.Id, CancellationToken.None);
        var waiting = () => bookings.CalendarAsync(noa, noas.Id, CancellationToken.None);

        (await someoneElses.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("booking.not_found");
        (await waiting.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("booking.not_found");
        _ = dana;
    }

    private static async Task<(TenantContext Owner, BookingService Bookings, Guid ClassType, Guid Room)> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        var owner = new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
        var timetable = new TimetableService(db, TimeProvider.System);
        var classType = await timetable.CreateClassTypeAsync(owner, new NewClassType("פילאטיס מכשירים", "pilates", "rose", 50, null), CancellationToken.None);
        var room = await timetable.CreateRoomAsync(owner, new NewRoom("חדר המכשירים", 8), CancellationToken.None);
        return (owner, new BookingService(db, TimeProvider.System), classType.Id, room.Id);
    }

    /// <summary>A member with a login: an account, a client membership, and the people row linked to it.</summary>
    private static async Task<(TenantContext Member, Guid PersonId)> MemberWithCardAsync(MigratedDatabase db, TenantContext owner, string email)
    {
        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account, email);
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', 'active', now(), now())",
            owner.OrganizationId, membershipId, account);
        var person = (await new PeopleService(db).CreateAsync(owner, new NewPerson(email.Split('@')[0], null, null, null, email, null), CancellationToken.None)).Person.Id;
        await db.AsMasterAsync("UPDATE people.people SET user_account_id = $1, membership_id = $2 WHERE id = $3", account, membershipId, person);
        var passes = new PassService(db, TimeProvider.System);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, null), CancellationToken.None);
        await passes.GrantAsync(owner, person, new NewPass(card.Id, null, null), CancellationToken.None);
        return (new TenantContext(owner.OrganizationId, account, membershipId, MembershipRole.Client, OrganizationStatus.Active, "test"), person);
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, TenantContext owner, Guid classType, Guid room, int capacity = 8)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.AddDays(1);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, room_id, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', now(), now())",
            owner.OrganizationId, id, DateOnly.FromDateTime(startsAt.UtcDateTime), classType, startsAt, startsAt.AddMinutes(50), room, capacity);
        return id;
    }
}
