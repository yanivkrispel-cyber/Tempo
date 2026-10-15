using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The caller's own record and consent, consent history, consent on behalf and
/// relationships (docs/27 sections 3.4, 4.3 and 4.4) against PostgreSQL 18 as `tempo_app`.
/// </summary>
public sealed class ConsentServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task MyProfile_IsTheRecordCreatedWithTheStudio_AndEditableByTheMember()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var consents = Service(db);

        var mine = await consents.GetMyProfileAsync(owner, CancellationToken.None);
        var updated = await consents.UpdateMyProfileAsync(owner, new ProfileChanges("Kris K.", default, default, FieldChange.Set<DateOnly?>(new DateOnly(1985, 3, 2))), null, CancellationToken.None);

        mine.Person.Source.Should().Be("organization_created");
        mine.Person.HasLogin.Should().BeTrue();
        mine.ContactPoints.Should().ContainSingle().Which.Verified.Should().BeTrue();
        updated.Person.DisplayName.Should().Be("Kris K.");
        updated.Person.BirthDate.Should().Be(new DateOnly(1985, 3, 2));
    }

    [Fact]
    public async Task Consent_IsAppendOnly_AndTheLatestRowIsTheCurrentState()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var consents = Service(db);

        await consents.RecordMyConsentAsync(owner, new ConsentChoice("marketing", "email", "granted", "marketing-he-2026-10"), CancellationToken.None);
        await consents.RecordMyConsentAsync(owner, new ConsentChoice("marketing", "email", "withdrawn", "marketing-he-2026-10"), CancellationToken.None);
        await consents.RecordMyConsentAsync(owner, new ConsentChoice("reminders", "push", "granted", "reminders-he-2026-10"), CancellationToken.None);

        var profile = await consents.GetMyProfileAsync(owner, CancellationToken.None);
        var history = await consents.HistoryAsync(owner, profile.Person.Id, CancellationToken.None);

        profile.Consents.Should().HaveCount(2);
        profile.Consents.Single(c => c.Purpose == "marketing").State.Should().Be("withdrawn");
        profile.Consents.Should().OnlyContain(c => c.Method == "self" && c.RecordedByMembershipId == owner.MembershipId);
        history.Select(c => c.State).Should().Equal("granted", "withdrawn", "granted");
    }

    [Fact]
    public async Task Consent_IsValidated()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var consents = Service(db);

        var badChannel = () => consents.RecordMyConsentAsync(owner, new ConsentChoice("marketing", "sms", "granted", "v1"), CancellationToken.None);
        var noVersion = () => consents.RecordMyConsentAsync(owner, new ConsentChoice("marketing", "email", "granted", " "), CancellationToken.None);

        (await badChannel.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("consent.invalid");
        (await noVersion.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("consent.invalid");
    }

    [Fact]
    public async Task OnBehalf_IsRecordedAsStaffOnBehalf()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var walkIn = await new PeopleService(db).CreateAsync(owner, new NewPerson("Noa", null, null, null, null, "050-2345678"), CancellationToken.None);

        var recorded = await Service(db).RecordOnBehalfAsync(owner, walkIn.Person.Id, new ConsentChoice("reminders", "whatsapp", "granted", "paper-2026-10"), CancellationToken.None);

        recorded.Method.Should().Be("staff_on_behalf");
        recorded.RecordedByMembershipId.Should().Be(owner.MembershipId);
    }

    [Fact]
    public async Task Relationships_LinkAGuardianToAChild_Once()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var parent = await people.CreateAsync(owner, new NewPerson("Dana", null, null, null, null, "050-2345678"), CancellationToken.None);
        var child = await people.CreateAsync(owner, new NewPerson("Yoav", null, null, new DateOnly(2018, 1, 1), "dana@example.com", null), CancellationToken.None);
        var consents = Service(db);

        var link = await consents.AddRelationshipAsync(owner, parent.Person.Id, "guardian_of", child.Person.Id, CancellationToken.None);
        var again = () => consents.AddRelationshipAsync(owner, parent.Person.Id, "guardian_of", child.Person.Id, CancellationToken.None);
        var self = () => consents.AddRelationshipAsync(owner, parent.Person.Id, "guardian_of", parent.Person.Id, CancellationToken.None);

        link.OtherDisplayName.Should().Be("Yoav");
        (await people.GetAsync(owner, child.Person.Id, CancellationToken.None)).Relationships.Should().ContainSingle().Which.OtherDisplayName.Should().Be("Dana");
        (await again.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("relationship.exists");
        (await self.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("relationship.self");

        await consents.DeleteRelationshipAsync(owner, child.Person.Id, link.Id, CancellationToken.None);
        (await people.GetAsync(owner, parent.Person.Id, CancellationToken.None)).Relationships.Should().BeEmpty();
    }

    [Fact]
    public async Task JoiningWithAVerifiedEmail_ClaimsTheWalkInRecord()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var walkIn = await new PeopleService(db).CreateAsync(owner, new NewPerson("Noa (front desk)", null, null, null, "noa@example.com", null), CancellationToken.None);

        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, display_name, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'Noa@Example.com', true, 'Noa', now(), now(), now())",
            account);
        var joinLinks = new JoinLinkService(db, new Tempo.Platform.Modules.Identity.Infrastructure.AttemptLimiter(db));
        var code = await joinLinks.RotateAsync(owner, CancellationToken.None);
        await joinLinks.JoinAsync(new AccountSnapshot(account, AccountStatus.Active, true), code, "c", CancellationToken.None);

        var claimed = await new PeopleService(db).GetAsync(owner, walkIn.Person.Id, CancellationToken.None);
        claimed.Person.HasLogin.Should().BeTrue();
        claimed.Person.MembershipId.Should().NotBeNull();
        claimed.ContactPoints.Single().Verified.Should().BeTrue();
        (await db.AsMasterAsync("SELECT count(*) FROM people.people WHERE organization_id = $1", owner.OrganizationId))
            .Should().Be(2L, "the owner and the claimed walk-in, no second record for Noa");
    }

    private static ConsentService Service(MigratedDatabase db) => new(db, new PeopleService(db));

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
