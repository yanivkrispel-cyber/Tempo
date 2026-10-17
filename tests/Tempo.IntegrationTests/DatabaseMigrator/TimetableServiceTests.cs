using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The timetable on PostgreSQL 18 (docs/29 sections 4 and 13): a weekly class materializes eight weeks of
/// sessions once, an edit rebuilds only unbooked future sessions, and members see up to the booking horizon.
/// </summary>
public sealed class TimetableServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task AWeeklyClass_MaterializesEightWeeks_Once()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var (classType, room) = await BasicsAsync(timetable, owner);

        var change = await timetable.CreateTemplateAsync(owner, new NewTemplate(classType.Id, 2, new TimeOnly(17, 30), null, owner.MembershipId, room.Id, 8, null, null), CancellationToken.None);

        var count = Convert.ToInt64(await db.AsMasterAsync("SELECT count(*) FROM scheduling.sessions WHERE template_id = $1", change.Template.Id), System.Globalization.CultureInfo.InvariantCulture);
        count.Should().BeInRange(8, 9, "every Tuesday from today to 56 days ahead");
        change.Template.Minutes.Should().Be(50, "the class type's default");
        // The console lists a weekly class with its class type, instructor and room in one read (A1).
        change.Template.ClassType!.Name.Should().Be("פילאטיס מכשירים");
        change.Template.Room!.Name.Should().Be("חדר המכשירים");
        change.Template.Instructor!.MembershipId.Should().Be(owner.MembershipId);
        (await timetable.ListTemplatesAsync(owner, CancellationToken.None)).Should().ContainSingle().Which.Should().BeEquivalentTo(change.Template);

        var again = await timetable.UpdateTemplateAsync(owner, change.Template.Id, new TemplateChanges(null, null, null, default, default, null, default), null, CancellationToken.None);
        again.UntouchedSessions.Should().BeEmpty();
        Convert.ToInt64(await db.AsMasterAsync("SELECT count(*) FROM scheduling.sessions WHERE template_id = $1", change.Template.Id), System.Globalization.CultureInfo.InvariantCulture)
            .Should().Be(count, "materializing again adds nothing");

        var sessions = await timetable.ListSessionsAsync(owner, new SessionQuery(DateOnly.FromDateTime(DateTime.UtcNow), DateOnly.FromDateTime(DateTime.UtcNow).AddDays(60), null, null), CancellationToken.None);
        sessions.Should().HaveCount((int)count).And.OnlyContain(s => s.ClassType.Name == "פילאטיס מכשירים" && s.Room!.Name == "חדר המכשירים" && s.Capacity == 8);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        sessions.Should().OnlyContain(s => TimeZoneInfo.ConvertTime(s.StartsAt, israel).TimeOfDay == new TimeSpan(17, 30, 0), "17:30 local on both sides of the DST change");
    }

    [Fact]
    public async Task EditingAWeeklyClass_KeepsBookedSessions_AndRebuildsTheRest()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var (classType, _) = await BasicsAsync(timetable, owner);
        var change = await timetable.CreateTemplateAsync(owner, new NewTemplate(classType.Id, 0, new TimeOnly(7, 0), 60, null, null, 10, null, null), CancellationToken.None);
        var booked = (Guid)(await db.AsMasterAsync("SELECT id FROM scheduling.sessions WHERE template_id = $1 ORDER BY starts_at LIMIT 1", change.Template.Id))!;
        var person = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1", owner.OrganizationId))!;
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'booked', $5, now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), booked, person, owner.MembershipId);

        var edited = await timetable.UpdateTemplateAsync(
            owner, change.Template.Id, new TemplateChanges(null, new TimeOnly(8, 0), null, default, default, 12, default), change.Template.Version, CancellationToken.None);

        edited.UntouchedSessions.Should().ContainSingle().Which.Id.Should().Be(booked);
        edited.UntouchedSessions[0].Capacity.Should().Be(10, "a booked session keeps its values");
        var rebuilt = Convert.ToInt64(await db.AsMasterAsync("SELECT count(*) FROM scheduling.sessions WHERE template_id = $1 AND capacity = 12 AND id <> $2", change.Template.Id, booked), System.Globalization.CultureInfo.InvariantCulture);
        rebuilt.Should().BeGreaterThan(5);

        var stale = () => timetable.UpdateTemplateAsync(owner, change.Template.Id, new TemplateChanges(null, null, 45, default, default, null, default), change.Template.Version, CancellationToken.None);
        (await stale.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("concurrency.conflict");
    }

    [Fact]
    public async Task Members_SeeUpToTheBookingHorizon()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var (classType, _) = await BasicsAsync(timetable, owner);
        foreach (var weekday in Enumerable.Range(0, 7))
        {
            await timetable.CreateTemplateAsync(owner, new NewTemplate(classType.Id, weekday, new TimeOnly(19, 0), null, null, null, 6, null, null), CancellationToken.None);
        }

        var client = owner with { Role = MembershipRole.Client, Permissions = SystemRoles.Client.Permissions };
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var seen = await timetable.ListSessionsAsync(client, new SessionQuery(today, today.AddDays(40), null, null), CancellationToken.None);

        seen.Should().NotBeEmpty().And.OnlyContain(s => s.LocalDate <= today.AddDays(15), "14 days ahead by default, in the studio's time zone");
        (await timetable.ListSessionsAsync(owner, new SessionQuery(today, today.AddDays(40), null, null), CancellationToken.None))
            .Should().HaveCountGreaterThan(seen.Count, "staff see the whole range");
    }

    [Fact]
    public async Task AOneOffSession_NeedsAnActiveClassTypeAndAFutureTime()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var (classType, room) = await BasicsAsync(timetable, owner);
        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(2);

        var session = await timetable.CreateSessionAsync(owner, new NewSession(classType.Id, tomorrow, new TimeOnly(10, 0), null, null, room.Id, 4), CancellationToken.None);
        session.TemplateId.Should().BeNull();
        session.EndsAt.Should().Be(session.StartsAt.AddMinutes(50));

        var past = () => timetable.CreateSessionAsync(owner, new NewSession(classType.Id, tomorrow.AddDays(-10), new TimeOnly(10, 0), null, null, null, 4), CancellationToken.None);
        (await past.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("localDate.invalid");

        await timetable.UpdateClassTypeAsync(owner, classType.Id, new ClassTypeChanges(null, null, null, null, default, "archived"), null, CancellationToken.None);
        var archived = () => timetable.CreateSessionAsync(owner, new NewSession(classType.Id, tomorrow, new TimeOnly(12, 0), null, null, null, 4), CancellationToken.None);
        (await archived.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("class_type.invalid");
    }

    [Fact]
    public async Task AWeeklyClassNobodyBooked_EndsBeforeItsFirstDay_AndLeavesNoSessions()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var (classType, _) = await BasicsAsync(timetable, owner);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var change = await timetable.CreateTemplateAsync(owner, new NewTemplate(classType.Id, 3, new TimeOnly(18, 0), null, null, null, 8, today.AddDays(10), null), CancellationToken.None);

        var ended = await timetable.UpdateTemplateAsync(owner, change.Template.Id, new TemplateChanges(null, null, null, default, default, null, new Change<DateOnly?>(true, today)), null, CancellationToken.None);

        ended.Template.ValidUntil.Should().Be(ended.Template.ValidFrom.AddDays(-1), "an empty range: the class never runs");
        (await db.AsMasterAsync("SELECT count(*)::int FROM scheduling.sessions WHERE template_id = $1", change.Template.Id)).Should().Be(0);
    }

    [Fact]
    public async Task AWeeklyClassWithABooking_CannotEndBeforeItsFirstDay()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        var (classType, _) = await BasicsAsync(timetable, owner);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var change = await timetable.CreateTemplateAsync(owner, new NewTemplate(classType.Id, 3, new TimeOnly(18, 0), null, null, null, 8, today.AddDays(10), null), CancellationToken.None);
        var session = (Guid)(await db.AsMasterAsync("SELECT id FROM scheduling.sessions WHERE template_id = $1 ORDER BY starts_at LIMIT 1", change.Template.Id))!;
        var person = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1", owner.OrganizationId))!;
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'booked', $5, now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), session, person, owner.MembershipId);

        var end = () => timetable.UpdateTemplateAsync(owner, change.Template.Id, new TemplateChanges(null, null, null, default, default, null, new Change<DateOnly?>(true, today)), null, CancellationToken.None);

        (await end.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("template.has_bookings");
    }

    private static async Task<(ClassTypeView ClassType, RoomView Room)> BasicsAsync(TimetableService timetable, TenantContext owner)
    {
        var room = await timetable.CreateRoomAsync(owner, new NewRoom("חדר המכשירים", 8), CancellationToken.None);
        var classType = await timetable.CreateClassTypeAsync(owner, new NewClassType("פילאטיס מכשירים", "pilates", "rose", 50, null), CancellationToken.None);
        return (classType, room);
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
