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
/// Moving a booked place to another class (docs/29 section 16.1) on PostgreSQL 18: the entry moves with it,
/// the old class promotes its waitlist, a full or uncovered target changes nothing, and two moves into the last
/// place cannot overbook.
/// </summary>
public sealed class BookingMoveTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Move_KeepsTheEntry_FreesTheOldPlace_AndPromotesTheWaiter()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", 10);
        var noa = await PersonWithCardAsync(s, "Noa", 10);
        var from = await SessionAsync(db, s, s.ClassType, 1, TimeSpan.FromDays(1));
        var to = await SessionAsync(db, s, s.ClassType, 1, TimeSpan.FromDays(2));
        var old = await s.Bookings.BookAsync(s.Owner, from, dana, CancellationToken.None);
        var waiting = await s.Bookings.BookAsync(s.Owner, from, noa, CancellationToken.None);
        waiting.Status.Should().Be("waitlisted");

        var moved = await s.Bookings.MoveAsync(s.Owner, old.Id, to, CancellationToken.None);

        moved.Id.Should().NotBe(old.Id);
        moved.Should().BeEquivalentTo(new { SessionId = to, Status = "booked", LateCancel = false });
        moved.Pass!.EntriesLeft.Should().Be(9, "the entry moved with the place");
        (await EntriesUsedAsync(db, dana)).Should().Be(1);
        var left = (await s.Bookings.ListForPersonAsync(s.Owner, dana, upcoming: false, null, 10, CancellationToken.None)).Items.Single(i => i.Booking.Id == old.Id).Booking;
        left.Should().BeEquivalentTo(new { Status = "cancelled", CancelReason = "moved", LateCancel = false });
        (await s.Bookings.RosterAsync(s.Owner, from, CancellationToken.None)).Booked.Should().ContainSingle().Which.Person.Id.Should().Be(noa, "the waiter took the freed place");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'booking.moved' AND target_id = $1", moved.Id)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE person_id = $1 AND kind = 'booking.moved'", dana)).Should().Be(1L);
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task Move_IntoAFullClass_ChangesNothing()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", 10);
        var noa = await PersonWithCardAsync(s, "Noa", 10);
        var from = await SessionAsync(db, s, s.ClassType, 2, TimeSpan.FromDays(1));
        var to = await SessionAsync(db, s, s.ClassType, 1, TimeSpan.FromDays(2));
        var old = await s.Bookings.BookAsync(s.Owner, from, dana, CancellationToken.None);
        await s.Bookings.BookAsync(s.Owner, to, noa, CancellationToken.None);

        var move = () => s.Bookings.MoveAsync(s.Owner, old.Id, to, CancellationToken.None);

        (await move.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("session.full");
        (await s.Bookings.RosterAsync(s.Owner, from, CancellationToken.None)).Booked.Should().ContainSingle().Which.Status.Should().Be("booked");
        (await EntriesUsedAsync(db, dana)).Should().Be(1);
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task Move_ToAClassThePassDoesNotCover_IsRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var email = $"{Guid.NewGuid():N}@example.com";
        var dana = (await s.People.CreateAsync(s.Owner, new NewPerson("Dana", null, null, null, email, null), CancellationToken.None)).Person.Id;
        var pilatesOnly = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("punch_card", "פילאטיס בלבד", 10, 90, null, "pilates", null), CancellationToken.None);
        await s.Passes.GrantAsync(s.Owner, dana, new NewPass(pilatesOnly.Id, null, null), CancellationToken.None);
        var yoga = await s.Timetable.CreateClassTypeAsync(s.Owner, new NewClassType("יוגה", "yoga", "sage", 60, null), CancellationToken.None);
        var from = await SessionAsync(db, s, s.ClassType, 2, TimeSpan.FromDays(1));
        var to = await SessionAsync(db, s, yoga.Id, 2, TimeSpan.FromDays(2));
        var old = await s.Bookings.BookAsync(s.Owner, from, dana, CancellationToken.None);

        var move = () => s.Bookings.MoveAsync(s.Owner, old.Id, to, CancellationToken.None);

        (await move.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("booking.no_valid_pass");
        (await s.Bookings.RosterAsync(s.Owner, to, CancellationToken.None)).Booked.Should().BeEmpty();
        (await EntriesUsedAsync(db, dana)).Should().Be(1);
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task Move_ByAMember_IsForbidden()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", 10);
        var from = await SessionAsync(db, s, s.ClassType, 2, TimeSpan.FromDays(1));
        var to = await SessionAsync(db, s, s.ClassType, 2, TimeSpan.FromDays(2));
        var old = await s.Bookings.BookAsync(s.Owner, from, dana, CancellationToken.None);
        var member = s.Owner with { Role = MembershipRole.Client, Permissions = new HashSet<string> { Permissions.ScheduleView } };

        var move = () => s.Bookings.MoveAsync(member, old.Id, to, CancellationToken.None);

        (await move.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
    }

    [Fact]
    public async Task TwoMoves_IntoTheLastPlace_LetExactlyOneIn()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var from = await SessionAsync(db, s, s.ClassType, 5, TimeSpan.FromDays(1));
        var to = await SessionAsync(db, s, s.ClassType, 1, TimeSpan.FromDays(2));
        var bookings = new List<Guid>();
        for (var i = 0; i < 4; i++)
        {
            var person = await PersonWithCardAsync(s, $"Member {i}", 10);
            bookings.Add((await s.Bookings.BookAsync(s.Owner, from, person, CancellationToken.None)).Id);
        }

        var outcomes = await Task.WhenAll(bookings.Select(async id =>
        {
            try
            {
                await new BookingService(db, TimeProvider.System).MoveAsync(s.Owner, id, to, CancellationToken.None);
                return "moved";
            }
            catch (DomainRuleViolationException e)
            {
                return e.Code;
            }
        }));

        outcomes.Count(o => o == "moved").Should().Be(1);
        outcomes.Count(o => o == "session.full").Should().Be(3);
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", to)).Should().Be(1);
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", from)).Should().Be(3);
        await LedgerMatchesAsync(db);
    }

    private sealed record Studio(TenantContext Owner, PeopleService People, PassService Passes, BookingService Bookings, TimetableService Timetable, Guid ClassType, Guid Card);

    private static async Task<Studio> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        var owner = new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
        var timetable = new TimetableService(db, TimeProvider.System);
        var passes = new PassService(db, TimeProvider.System);
        var classType = await timetable.CreateClassTypeAsync(owner, new NewClassType("פילאטיס מכשירים", "pilates", "rose", 50, null), CancellationToken.None);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כרטיסייה", 10, 90, null, null, null), CancellationToken.None);
        return new Studio(owner, new PeopleService(db), passes, new BookingService(db, TimeProvider.System), timetable, classType.Id, card.Id);
    }

    private static async Task<Guid> PersonWithCardAsync(Studio s, string name, int entries)
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var person = (await s.People.CreateAsync(s.Owner, new NewPerson(name, null, null, null, email, null), CancellationToken.None)).Person.Id;
        var product = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("punch_card", $"כרטיסיית {entries}", entries, 90, null, null, null), CancellationToken.None);
        await s.Passes.GrantAsync(s.Owner, person, new NewPass(product.Id, null, null), CancellationToken.None);
        return person;
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, Studio s, Guid classType, int capacity, TimeSpan startsIn)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.Add(startsIn);
        var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(startsAt, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', now(), now())",
            s.Owner.OrganizationId, id, localDate, classType, startsAt, startsAt.AddMinutes(50), capacity);
        return id;
    }

    private static async Task<int> EntriesUsedAsync(MigratedDatabase db, Guid person) =>
        (int)(await db.AsMasterAsync("SELECT coalesce(sum(entries_used), 0)::int FROM scheduling.passes WHERE person_id = $1 AND status = 'active'", person))!;

    /// <summary>The ledger is the source of truth: every card's counter equals its held uses.</summary>
    private static async Task LedgerMatchesAsync(MigratedDatabase db) =>
        (await db.AsMasterAsync(
            """
            SELECT count(*) FROM scheduling.passes ps
            WHERE ps.entries IS NOT NULL
              AND ps.entries_used <> (SELECT count(*) FROM scheduling.pass_uses u WHERE u.pass_id = ps.id AND u.status = 'held')
            """)).Should().Be(0L);
}
