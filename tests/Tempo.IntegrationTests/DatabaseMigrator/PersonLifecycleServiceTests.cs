using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Duplicates and merge, export and erasure (docs/27 sections 4.6 and 4.7)
/// against PostgreSQL 18 as `tempo_app`. A record that stops being live gives
/// up its login, so the account can rejoin (review note on #71).
/// </summary>
public sealed class PersonLifecycleServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static readonly string[] SurvivorContacts = ["+972502345678", "noa@example.com"];

    [Fact]
    public async Task Merge_MovesContactsConsentAndRelationships_AndPointsTheOldRecordAtTheSurvivor()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var consents = new ConsentService(db, people);
        var keep = await people.CreateAsync(owner, new NewPerson("Noa Levi", null, null, null, null, "050-2345678"), CancellationToken.None);
        var drop = await people.CreateAsync(owner, new NewPerson("Noa L", null, null, null, "noa@example.com", "0502345678"), CancellationToken.None);
        var child = await people.CreateAsync(owner, new NewPerson("Yoav", null, null, null, "parent@example.com", null), CancellationToken.None);
        await consents.RecordOnBehalfAsync(owner, drop.Person.Id, new ConsentChoice("marketing", "email", "granted", "v1"), CancellationToken.None);
        await consents.AddRelationshipAsync(owner, drop.Person.Id, "guardian_of", child.Person.Id, CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System);
        var candidate = (await lifecycle.ListCandidatesAsync(owner, null, null, 10, CancellationToken.None)).Items.Single();

        var resolved = await lifecycle.ResolveAsync(owner, candidate.Id, "merge", keep.Person.Id, CancellationToken.None);

        resolved.Status.Should().Be("merged");
        var survivor = await people.GetAsync(owner, keep.Person.Id, CancellationToken.None);
        survivor.ContactPoints.Select(c => c.Value).Should().BeEquivalentTo(SurvivorContacts, "the shared phone is not doubled");
        survivor.ContactPoints.Where(c => c.Type == "phone" && c.IsPrimary).Should().ContainSingle();
        survivor.Consents.Should().ContainSingle().Which.State.Should().Be("granted");
        survivor.Relationships.Should().ContainSingle().Which.OtherDisplayName.Should().Be("Yoav");
        var old = await people.GetAsync(owner, drop.Person.Id, CancellationToken.None);
        old.Person.Status.Should().Be("merged");
        old.Person.MergedIntoId.Should().Be(keep.Person.Id);
        old.ContactPoints.Should().BeEmpty();
    }

    [Fact]
    public async Task Merge_RefusesTwoPeopleWhoBothSignIn_AndNotDuplicateClosesThePair()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var a = await JoinAsync(db, owner, "a@example.com");
        var b = await JoinAsync(db, owner, "b@example.com");
        var people = new PeopleService(db);
        var aId = (await people.ListAsync(owner, new PeopleQuery("a@example.com", null, null, 10), CancellationToken.None)).Items.Single().Id;
        var bId = (await people.ListAsync(owner, new PeopleQuery("b@example.com", null, null, 10), CancellationToken.None)).Items.Single().Id;
        await people.AddContactAsync(owner, aId, "phone", "050-2345678", false, CancellationToken.None);
        await people.AddContactAsync(owner, bId, "phone", "050-2345678", false, CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System);
        var candidate = (await lifecycle.ListCandidatesAsync(owner, null, null, 10, CancellationToken.None)).Items.Single();

        var merge = () => lifecycle.ResolveAsync(owner, candidate.Id, "merge", aId, CancellationToken.None);
        (await merge.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.merge_both_have_login");

        var closed = await lifecycle.ResolveAsync(owner, candidate.Id, "not_duplicate", null, CancellationToken.None);
        closed.Status.Should().Be("not_duplicate");
        (a, b).Should().NotBe(default);
    }

    [Fact]
    public async Task Merge_MovesTheLoginToTheSurvivor_WhenOnlyTheMergedRecordHadOne()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var walkIn = await people.CreateAsync(owner, new NewPerson("Dana", null, null, null, null, "050-2345678"), CancellationToken.None);
        await JoinAsync(db, owner, "dana@example.com");
        var login = (await people.ListAsync(owner, new PeopleQuery("dana@example.com", null, null, 10), CancellationToken.None)).Items.Single();
        await people.AddContactAsync(owner, login.Id, "phone", "050-2345678", false, CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System);
        var candidate = (await lifecycle.ListCandidatesAsync(owner, null, null, 10, CancellationToken.None)).Items.Single();

        await lifecycle.ResolveAsync(owner, candidate.Id, "merge", walkIn.Person.Id, CancellationToken.None);

        var survivor = await people.GetAsync(owner, walkIn.Person.Id, CancellationToken.None);
        survivor.Person.HasLogin.Should().BeTrue();
        survivor.Person.MembershipId.Should().Be(login.MembershipId);
        (await people.GetAsync(owner, login.Id, CancellationToken.None)).Person.HasLogin.Should().BeFalse();
    }

    [Fact]
    public async Task Erase_AnonymizesKeepsConsentProof_AndTheAccountCanRejoin()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var member = await JoinAsync(db, owner, "erase-me@example.com");
        var record = (await people.ListAsync(owner, new PeopleQuery("erase-me@example.com", null, null, 10), CancellationToken.None)).Items.Single();
        await new ConsentService(db, people).RecordOnBehalfAsync(owner, record.Id, new ConsentChoice("reminders", "push", "granted", "v1"), CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System);

        var erased = await lifecycle.EraseAsync(owner, record.Id, "Asked to be forgotten", CancellationToken.None);

        erased.Person.Status.Should().Be("anonymized");
        erased.Person.DisplayName.Should().Be(PersonLifecycleService.ErasedName);
        erased.Person.HasLogin.Should().BeFalse();
        erased.ContactPoints.Should().BeEmpty();
        erased.Consents.Should().ContainSingle("consent state and time stay as proof");
        (await db.AsMasterAsync("SELECT data::text FROM audit.audit_events WHERE action = 'person.erased' AND target_id = $1", record.Id) as string)
            .Should().NotContain("forgotten", "the free-text reason is not kept in audit");
        var again = () => lifecycle.EraseAsync(owner, record.Id, "Asked to be forgotten", CancellationToken.None);
        (await again.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.read_only");

        // The member leaves and comes back: a new record, no clash with the anonymized one.
        await new MemberService(db, new AccountProfiles(db)).RemoveAsync(owner, member.MembershipId, CancellationToken.None);
        await RejoinAsync(db, owner, member.UserAccountId);
        (await people.ListAsync(owner, new PeopleQuery("erase-me@example.com", null, null, 10), CancellationToken.None)).Items
            .Should().ContainSingle().Which.Id.Should().NotBe(record.Id);
    }

    [Fact]
    public async Task Erase_RevokesThePendingInvitation_AndScrubsItsEmail()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var walkIn = await people.CreateAsync(owner, new NewPerson("Dana", null, null, null, null, "050-2345678"), CancellationToken.None);
        var invitations = new InvitationService(db, new AccountProfiles(db), new AttemptLimiter(db));
        var invite = await invitations.CreateAsync(owner, "dana@example.com", MembershipRole.Client, CancellationToken.None, walkIn.Person.Id);

        await new PersonLifecycleService(db, TimeProvider.System).EraseAsync(owner, walkIn.Person.Id, "Asked to be forgotten", CancellationToken.None);

        (await db.AsMasterAsync("SELECT status FROM organizations.invitations WHERE id = $1", invite.Invitation.Id) as string).Should().Be("revoked");
        (await db.AsMasterAsync("SELECT email FROM organizations.invitations WHERE id = $1", invite.Invitation.Id) as string).Should().EndWith("@invalid");
        (await db.AsMasterAsync("SELECT string_agg(data::text, ' ') FROM audit.audit_events WHERE organization_id = $1", owner.OrganizationId) as string)
            .Should().NotContain("dana@example.com", "audit keeps ids only");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'invitation.revoked' AND target_id = $1", invite.Invitation.Id)).Should().Be(1L);
    }

    [Fact]
    public async Task Export_HoldsTheRecordAndTheFullConsentHistory()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var noa = await people.CreateAsync(owner, new NewPerson("Noa", null, null, null, null, "050-2345678"), CancellationToken.None);
        var consents = new ConsentService(db, people);
        await consents.RecordOnBehalfAsync(owner, noa.Person.Id, new ConsentChoice("marketing", "email", "granted", "v1"), CancellationToken.None);
        await consents.RecordOnBehalfAsync(owner, noa.Person.Id, new ConsentChoice("marketing", "email", "withdrawn", "v1"), CancellationToken.None);

        var export = await new PersonLifecycleService(db, TimeProvider.System).ExportAsync(owner, noa.Person.Id, CancellationToken.None);

        export.OrganizationName.Should().Be("Main");
        export.Person.Person.PrimaryPhone.Should().Be("+972502345678");
        export.ConsentHistory.Select(c => c.State).Should().Equal("granted", "withdrawn");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'person.exported' AND target_id = $1", noa.Person.Id)).Should().Be(1L);
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db)
    {
        var id = await AccountAsync(db, "owner@example.com");
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }

    private static async Task<TenantContext> JoinAsync(MigratedDatabase db, TenantContext owner, string email)
    {
        var account = await AccountAsync(db, email);
        return await RejoinAsync(db, owner, account);
    }

    private static async Task<TenantContext> RejoinAsync(MigratedDatabase db, TenantContext owner, Guid account)
    {
        var joinLinks = new JoinLinkService(db, new AttemptLimiter(db));
        var code = await joinLinks.RotateAsync(owner, CancellationToken.None);
        var membership = await joinLinks.JoinAsync(new AccountSnapshot(account, AccountStatus.Active, true), code, "c", CancellationToken.None);
        return new TenantContext(owner.OrganizationId, account, membership.MembershipId, MembershipRole.Client, OrganizationStatus.Active, "test");
    }

    private static async Task<Guid> AccountAsync(MigratedDatabase db, string email)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id, email);
        return id;
    }
}
