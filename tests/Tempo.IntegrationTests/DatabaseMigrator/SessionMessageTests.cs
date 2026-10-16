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
/// A message to everyone registered on a class (docs/29 section 16.2) on PostgreSQL 18: booked and waiting people
/// get it in their inbox, the audit log never holds the text, five per hour per class, the instructor may send,
/// a member may not, and erasing a person removes their message items.
/// </summary>
public sealed class SessionMessageTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string Text = "החדר הוחלף לאולם הגדול, להביא מגבת";

    [Fact]
    public async Task Send_ReachesBookedAndWaiting_AndTheAuditLogKeepsNoText()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, 1);
        var dana = await PersonWithCardAsync(s, "Dana");
        var noa = await PersonWithCardAsync(s, "Noa");
        var gone = await PersonWithCardAsync(s, "Gone");
        await s.Bookings.BookAsync(s.Owner, session, dana, CancellationToken.None);
        await s.Bookings.BookAsync(s.Owner, session, noa, CancellationToken.None);
        var cancelled = await s.Bookings.BookAsync(s.Owner, session, gone, CancellationToken.None);
        await s.Bookings.CancelAsync(s.Owner, cancelled.Id, false, CancellationToken.None);

        var sent = await s.Bookings.SendAsync(s.Owner, session, $"  {Text}  ", CancellationToken.None);

        sent.Recipients.Should().Be(2, "booked and waiting, not the one who cancelled");
        (await db.AsMasterAsync("SELECT body FROM notifications.session_messages WHERE id = $1", sent.Id)).Should().Be(Text, "trimmed");
        foreach (var person in new[] { dana, noa })
        {
            (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE person_id = $1 AND kind = 'session.message' AND (data ->> 'messageId')::uuid = $2", person, sent.Id)).Should().Be(1L);
        }

        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE person_id = $1", gone)).Should().Be(0L);
        (await db.AsMasterAsync("SELECT string_agg(data::text, ' ') FROM audit.audit_events WHERE organization_id = $1", s.Owner.OrganizationId) as string)
            .Should().NotContain("מגבת", "the text is never in the audit log");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'session.message_sent' AND target_id = $1 AND (data ->> 'recipients')::int = 2", session)).Should().Be(1L);
    }

    [Fact]
    public async Task Send_IsLimitedToFivePerClassPerHour()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, 5);
        for (var i = 0; i < BookingService.MessagesPerHour; i++)
        {
            await s.Bookings.SendAsync(s.Owner, session, $"הודעה {i}", CancellationToken.None);
        }

        var sixth = () => s.Bookings.SendAsync(s.Owner, session, "עוד אחת", CancellationToken.None);

        (await sixth.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("session.message_limit");
    }

    [Fact]
    public async Task Send_ByTheInstructor_Works_AndByAMember_IsForbidden()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var instructor = await MemberAsync(db, s.Owner.OrganizationId, "instructor@example.com", MembershipRole.Staff);
        var session = await SessionAsync(db, s, 5, instructor.MembershipId);
        var asInstructor = instructor with { Permissions = new HashSet<string> { Permissions.ScheduleView } };
        var member = await MemberAsync(db, s.Owner.OrganizationId, "member@example.com", MembershipRole.Client);

        (await s.Bookings.SendAsync(asInstructor, session, Text, CancellationToken.None)).SessionId.Should().Be(session);
        var byMember = () => s.Bookings.SendAsync(member, session, Text, CancellationToken.None);
        (await byMember.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
        var empty = () => s.Bookings.SendAsync(s.Owner, session, "   ", CancellationToken.None);
        (await empty.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("text.invalid");
    }

    [Fact]
    public async Task Erase_RemovesThePersonsMessageItems()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var s = await StudioAsync(db);
        var session = await SessionAsync(db, s, 5);
        var dana = await PersonWithCardAsync(s, "Dana");
        await s.Bookings.BookAsync(s.Owner, session, dana, CancellationToken.None);
        await s.Bookings.SendAsync(s.Owner, session, Text, CancellationToken.None);

        await new PersonLifecycleService(db, TimeProvider.System).EraseAsync(s.Owner, dana, "Asked to be forgotten", CancellationToken.None);

        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE person_id = $1 AND kind = 'session.message'", dana)).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.session_messages WHERE session_id = $1", session)).Should().Be(1L, "the message itself is the studio's, ids only");
    }

    private sealed record Studio(TenantContext Owner, PeopleService People, PassService Passes, BookingService Bookings, Guid ClassType);

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

    private static async Task<Guid> PersonWithCardAsync(Studio s, string name)
    {
        var person = (await s.People.CreateAsync(s.Owner, new NewPerson(name, null, null, null, $"{Guid.NewGuid():N}@example.com", null), CancellationToken.None)).Person.Id;
        var product = await s.Passes.CreateProductAsync(s.Owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, null), CancellationToken.None);
        await s.Passes.GrantAsync(s.Owner, person, new NewPass(product.Id, null, null), CancellationToken.None);
        return person;
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, Studio s, int capacity, Guid? instructorMembershipId = null)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.AddDays(1);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, instructor_membership_id, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', now(), now())",
            s.Owner.OrganizationId, id, DateOnly.FromDateTime(startsAt.UtcDateTime), s.ClassType, startsAt, startsAt.AddMinutes(50), instructorMembershipId, capacity);
        return id;
    }
}
