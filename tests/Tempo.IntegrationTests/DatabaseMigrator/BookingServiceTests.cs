using System.Diagnostics;
using System.Runtime.CompilerServices;
using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Booking on PostgreSQL 18 (docs/29 sections 5.4, 6 and 13): entries are held and returned, the waitlist
/// promotes in order, and concurrent bookings neither overbook nor spend an entry twice.
/// </summary>
public sealed class BookingServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task ABooking_HoldsAnEntry_AndAFreeCancellationReturnsIt()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", entries: 10);
        var session = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(2));

        var booking = await s.Bookings.BookAsync(s.Owner, session, dana, CancellationToken.None);

        booking.Status.Should().Be("booked");
        booking.Pass!.EntriesLeft.Should().Be(9);
        var cancelled = await s.Bookings.CancelAsync(s.Owner, booking.Id, false, CancellationToken.None);
        cancelled.Status.Should().Be("cancelled");
        cancelled.LateCancel.Should().BeFalse();
        (await EntriesUsedAsync(db, dana)).Should().Be(0);
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task ALateCancellation_KeepsTheEntryUsed_UnlessStaffReturnIt()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", entries: 10);
        var soon = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromHours(3));
        var alsoSoon = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromHours(4));

        var late = await s.Bookings.CancelAsync(s.Owner, (await s.Bookings.BookAsync(s.Owner, soon, dana, CancellationToken.None)).Id, false, CancellationToken.None);
        late.LateCancel.Should().BeTrue("6 hours is the default free window");
        (await EntriesUsedAsync(db, dana)).Should().Be(1);

        await s.Bookings.CancelAsync(s.Owner, (await s.Bookings.BookAsync(s.Owner, alsoSoon, dana, CancellationToken.None)).Id, true, CancellationToken.None);
        (await EntriesUsedAsync(db, dana)).Should().Be(1, "staff returned the second one");
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task NoValidPass_RefusesTheBooking()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var noPass = (await s.People.CreateAsync(s.Owner, new NewPerson("Noa", null, null, null, "noa@example.com", null), CancellationToken.None)).Person.Id;
        var session = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(1));

        var book = () => s.Bookings.BookAsync(s.Owner, session, noPass, CancellationToken.None);

        (await book.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("booking.no_valid_pass");
    }

    [Fact]
    public async Task AFullClass_Waitlists_AndACancellationPromotesTheFirstInLine()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, capacity: 1, startsIn: TimeSpan.FromDays(1));
        var first = await PersonWithCardAsync(s, "First", entries: 5);
        var second = await PersonWithCardAsync(s, "Second", entries: 5);
        var third = await PersonWithCardAsync(s, "Third", entries: 5);

        var booked = await s.Bookings.BookAsync(s.Owner, session, first, CancellationToken.None);
        var waiting = await s.Bookings.BookAsync(s.Owner, session, second, CancellationToken.None);
        var waitingToo = await s.Bookings.BookAsync(s.Owner, session, third, CancellationToken.None);
        waiting.Status.Should().Be("waitlisted");
        waiting.WaitlistPosition.Should().Be(1);
        waiting.Pass.Should().BeNull("no entry is held while waiting");
        waitingToo.WaitlistPosition.Should().Be(2);

        await s.Bookings.CancelAsync(s.Owner, booked.Id, false, CancellationToken.None);

        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", waiting.Id)).Should().Be("booked");
        (await EntriesUsedAsync(db, second)).Should().Be(1);
        (await db.AsMasterAsync("SELECT kind FROM notifications.inbox_items WHERE person_id = $1", second)).Should().Be("booking.promoted");
        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", waitingToo.Id)).Should().Be("waitlisted");
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task Promotion_SkipsAWaiterWithNoValidPass()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, capacity: 1, startsIn: TimeSpan.FromDays(1));
        var first = await PersonWithCardAsync(s, "First", entries: 5);
        var second = await PersonWithCardAsync(s, "Second", entries: 5);
        var third = await PersonWithCardAsync(s, "Third", entries: 5);
        var booked = await s.Bookings.BookAsync(s.Owner, session, first, CancellationToken.None);
        var skipped = await s.Bookings.BookAsync(s.Owner, session, second, CancellationToken.None);
        var next = await s.Bookings.BookAsync(s.Owner, session, third, CancellationToken.None);
        await db.AsMasterAsync("UPDATE scheduling.passes SET status = 'voided' WHERE person_id = $1", second);

        await s.Bookings.CancelAsync(s.Owner, booked.Id, false, CancellationToken.None);

        (await db.AsMasterAsync("SELECT cancel_reason FROM scheduling.bookings WHERE id = $1", skipped.Id)).Should().Be("no_valid_pass");
        (await db.AsMasterAsync("SELECT kind FROM notifications.inbox_items WHERE person_id = $1", second)).Should().Be("booking.promotion_failed");
        (await db.AsMasterAsync("SELECT status FROM scheduling.bookings WHERE id = $1", next.Id)).Should().Be("booked");
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", session)).Should().Be(1);
    }

    [Fact]
    public async Task TwentyAtOnce_ForEightPlaces_GiveEightBookedAndTwelveWaiting()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(1));
        var people = new List<Guid>();
        for (var i = 0; i < 20; i++)
        {
            people.Add(await PersonWithCardAsync(s, $"Member {i}", entries: 3));
        }

        await Task.WhenAll(people.Select(p => Task.Run(() => s.Bookings.BookAsync(s.Owner, session, p, CancellationToken.None))));

        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.bookings WHERE session_id = $1 AND status = 'booked'", session)).Should().Be(8L);
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.bookings WHERE session_id = $1 AND status = 'waitlisted'", session)).Should().Be(12L);
        (await db.AsMasterAsync("SELECT count(DISTINCT waitlist_position) FROM scheduling.bookings WHERE session_id = $1 AND status = 'waitlisted'", session)).Should().Be(12L);
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", session)).Should().Be(8);
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task TheLastEntry_IsSpentOnce_UnderConcurrentBookings()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", entries: 1);
        var sessions = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            sessions.Add(await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(1) + TimeSpan.FromHours(i)));
        }

        var results = await Task.WhenAll(sessions.Select(id => Task.Run(async () =>
        {
            try
            {
                await s.Bookings.BookAsync(s.Owner, id, dana, CancellationToken.None);
                return "booked";
            }
            catch (DomainRuleViolationException e)
            {
                return e.Code;
            }
        })));

        results.Count(r => r == "booked").Should().Be(1);
        results.Where(r => r != "booked").Should().OnlyContain(r => r == "booking.no_valid_pass");
        (await EntriesUsedAsync(db, dana)).Should().Be(1);
        await LedgerMatchesAsync(db);
    }

    [Fact]
    public async Task AMember_BooksOnlyForThemselves()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var other = await PersonWithCardAsync(s, "Other", entries: 2);
        var session = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(1));
        var client = s.Owner with { Role = MembershipRole.Client, Permissions = SystemRoles.Client.Permissions };

        var forOther = () => s.Bookings.BookAsync(client, session, other, CancellationToken.None);
        (await forOther.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");

        var mine = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", s.Owner.OrganizationId, s.Owner.MembershipId))!;
        var card = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("membership", "מנוי חודשי", null, 30, null, null, null), CancellationToken.None);
        await s.Passes.GrantAsync(s.Owner, mine, new NewPass(card.Id, null, null), CancellationToken.None);

        var preview = (await s.Timetable.GetSessionAsync(client, session, CancellationToken.None)).PassPreview;
        preview!.Name.Should().Be("מנוי חודשי");
        var booked = await s.Bookings.BookAsync(client, session, null, CancellationToken.None);
        booked.Person.Id.Should().Be(mine);
        (await s.Timetable.GetSessionAsync(client, session, CancellationToken.None)).MyBooking!.Status.Should().Be("booked");
        (await s.Bookings.ListMineAsync(client, true, null, 10, CancellationToken.None)).Items.Should().ContainSingle();
        var twice = () => s.Bookings.BookAsync(client, session, null, CancellationToken.None);
        (await twice.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("booking.duplicate");
    }

    [Fact]
    public async Task UpcomingBookings_ArePagedInStartOrder()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var dana = await PersonWithCardAsync(s, "Dana", entries: 10);
        // Booked latest-first, so booking ids run opposite to start times (review from O13).
        var sessions = new List<Guid>();
        for (var i = 5; i >= 1; i--)
        {
            var session = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(i));
            sessions.Add(session);
            await s.Bookings.BookAsync(s.Owner, session, dana, CancellationToken.None);
        }

        var first = await s.Bookings.ListForPersonAsync(s.Owner, dana, true, null, 2, CancellationToken.None);
        var second = await s.Bookings.ListForPersonAsync(s.Owner, dana, true, first.NextBefore, 2, CancellationToken.None);

        first.Items.Select(i => i.Session.Id).Should().Equal(sessions[4], sessions[3]);
        second.Items.Select(i => i.Session.Id).Should().Equal(sessions[2], sessions[1]);
    }

    [Fact]
    public async Task ACancellation_SaysWhereItCameFrom_AndShowsThePassAfterTheEntryReturned()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, capacity: 1, startsIn: TimeSpan.FromDays(1));
        var first = await PersonWithCardAsync(s, "First", entries: 5);
        var second = await PersonWithCardAsync(s, "Second", entries: 5);
        var booked = await s.Bookings.BookAsync(s.Owner, session, first, CancellationToken.None);
        var waiting = await s.Bookings.BookAsync(s.Owner, session, second, CancellationToken.None);

        var leftLine = await s.Bookings.CancelAsync(s.Owner, waiting.Id, false, CancellationToken.None);
        var freed = await s.Bookings.CancelAsync(s.Owner, booked.Id, false, CancellationToken.None);

        leftLine.CancelledFrom.Should().Be("waitlisted");
        leftLine.Pass.Should().BeNull();
        freed.CancelledFrom.Should().Be("booked");
        freed.Pass!.EntriesLeft.Should().Be(5, "the entry returned and the pass still shows");
    }

    [Fact]
    public async Task TheInbox_NamesTheClass_AndMarksAllRead()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, capacity: 1, startsIn: TimeSpan.FromDays(1));
        var mine = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", s.Owner.OrganizationId, s.Owner.MembershipId))!;
        var other = await PersonWithCardAsync(s, "Other", entries: 5);
        var membership = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("membership", "מנוי", null, 30, null, null, null), CancellationToken.None);
        await s.Passes.GrantAsync(s.Owner, mine, new NewPass(membership.Id, null, null), CancellationToken.None);
        var taken = await s.Bookings.BookAsync(s.Owner, session, other, CancellationToken.None);
        await s.Bookings.BookAsync(s.Owner, session, null, CancellationToken.None);
        await s.Bookings.CancelAsync(s.Owner, taken.Id, false, CancellationToken.None);
        var settings = new StudioSettingsService(db);

        var inbox = await settings.ListInboxAsync(s.Owner, null, 10, CancellationToken.None);
        inbox.Items.Should().ContainSingle().Which.ClassTypeName.Should().Be("פילאטיס מכשירים");
        inbox.UnreadCount.Should().Be(1);
        await settings.MarkAllReadAsync(s.Owner, CancellationToken.None);
        (await settings.ListInboxAsync(s.Owner, null, 10, CancellationToken.None)).UnreadCount.Should().Be(0);
    }

    [Fact]
    public async Task TheInbox_CarriesEachClassSummary_InTheSameNumberOfQueries_ForOneItemOrThirty()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var mine = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", s.Owner.OrganizationId, s.Owner.MembershipId))!;
        var instructor = (string)(await db.AsMasterAsync("SELECT display_name FROM people.people WHERE id = $1", mine))!;
        var room = await s.Timetable.CreateRoomAsync(s.Owner, new NewRoom("חדר המכשירים", 8), CancellationToken.None);
        var session = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(1));
        await db.AsMasterAsync("UPDATE scheduling.sessions SET room_id = $2, instructor_membership_id = $3 WHERE id = $1", session, room.Id, s.Owner.MembershipId);
        var bare = await SessionAsync(db, s, capacity: 8, startsIn: TimeSpan.FromDays(2));
        var settings = new StudioSettingsService(db);

        await InboxItemsAsync(db, s, mine, session, 1);
        var (one, queriesForOne) = await CountingQueriesAsync(() => settings.ListInboxAsync(s.Owner, null, 50, CancellationToken.None));
        await InboxItemsAsync(db, s, mine, session, 28);
        await InboxItemsAsync(db, s, mine, bare, 1);
        var (thirty, queriesForThirty) = await CountingQueriesAsync(() => settings.ListInboxAsync(s.Owner, null, 50, CancellationToken.None));

        one.Items.Should().ContainSingle();
        thirty.Items.Should().HaveCount(30);
        queriesForThirty.Should().Be(queriesForOne, "the summaries come from the list's own query, not one read per item");
        queriesForOne.Should().BeGreaterThan(0, "the listener sees the service's queries");
        var withRoom = thirty.Items.Where(i => i.SessionId == session).ToList();
        withRoom.Should().HaveCount(29).And.OnlyContain(i =>
            i.ClassTypeName == "פילאטיס מכשירים" && i.RoomName == "חדר המכשירים" && i.InstructorName == instructor
            && i.SessionStatus == "scheduled" && i.SessionLocalDate != null && i.SessionStartsAt != null);
        var plain = thirty.Items.Single(i => i.SessionId == bare);
        plain.RoomName.Should().BeNull();
        plain.InstructorName.Should().BeNull();
        plain.SessionStatus.Should().Be("scheduled");
    }

    private static async Task InboxItemsAsync(MigratedDatabase db, Studio s, Guid person, Guid session, int count)
    {
        for (var i = 0; i < count; i++)
        {
            await db.AsMasterAsync(
                "INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, created_at) VALUES ($1, $2, $3, 'reminder.class_tomorrow', jsonb_build_object('sessionId', $4::text), now())",
                s.Owner.OrganizationId, Guid.CreateVersion7(), person, session);
        }
    }

    /// <summary>Counts the commands Npgsql runs inside <paramref name="action"/>'s own async flow (other tests run in parallel).</summary>
    private static async Task<(T Result, int Queries)> CountingQueriesAsync<T>(Func<Task<T>> action)
    {
        var counting = new AsyncLocal<StrongBox<int>?>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "Npgsql",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStarted = activity =>
            {
                if (counting.Value is { } box && activity.Kind == ActivityKind.Client)
                {
                    Interlocked.Increment(ref box.Value);
                }
            },
        };
        ActivitySource.AddActivityListener(listener);
        var queries = new StrongBox<int>(0);
        counting.Value = queries;
        var result = await action();
        counting.Value = null;
        return (result, queries.Value);
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

    private static async Task<Guid> SessionAsync(MigratedDatabase db, Studio s, int capacity, TimeSpan startsIn)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.Add(startsIn);
        var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(startsAt, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', now(), now())",
            s.Owner.OrganizationId, id, localDate, s.ClassType, startsAt, startsAt.AddMinutes(50), capacity);
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
