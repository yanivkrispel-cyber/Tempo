using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Person records (docs/27 sections 4.1, 4.2 and 4.6) against PostgreSQL 18 as
/// `tempo_app`: walk-ins with a phone or email, normalized contacts, one
/// primary per type, duplicate candidates, and tenant isolation.
/// </summary>
public sealed class PeopleServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Create_RecordsAWalkInWithNormalizedContacts_AndAudits()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);

        var created = await people.CreateAsync(owner, new NewPerson(" נועה לוי ", "נועה", "לוי", new DateOnly(1990, 5, 1), "Noa@Example.com", "050-2345678"), CancellationToken.None);

        created.Person.DisplayName.Should().Be("נועה לוי");
        created.Person.Source.Should().Be("staff_created");
        created.Person.HasLogin.Should().BeFalse();
        created.Person.PrimaryEmail.Should().Be("noa@example.com");
        created.Person.PrimaryPhone.Should().Be("+972502345678");
        created.ContactPoints.Should().OnlyContain(c => c.IsPrimary && !c.Verified);
        (await db.AsMasterAsync("SELECT data::text FROM audit.audit_events WHERE target_id = $1", created.Person.Id) as string)
            .Should().NotContain("noa").And.NotContain("נועה", "audit keeps ids and field names only");
    }

    [Fact]
    public async Task Create_NeedsANameAndAPhoneOrEmail()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);

        var noContact = () => people.CreateAsync(owner, new NewPerson("Noa", null, null, null, null, null), CancellationToken.None);
        var noName = () => people.CreateAsync(owner, new NewPerson("  ", null, null, null, null, "0502345678"), CancellationToken.None);
        var badPhone = () => people.CreateAsync(owner, new NewPerson("Noa", null, null, null, null, "12"), CancellationToken.None);

        (await noContact.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("contact.required");
        (await noName.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("display_name.required");
        (await badPhone.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("contact_point.invalid_phone");
    }

    [Fact]
    public async Task SharedPhoneOrNameAndBirthDate_FlagsADuplicateCandidate_WithoutMerging()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);

        var first = await people.CreateAsync(owner, new NewPerson("Noa Levi", null, null, new DateOnly(1990, 5, 1), null, "050-2345678"), CancellationToken.None);
        var samePhone = await people.CreateAsync(owner, new NewPerson("Dan Levi", null, null, null, null, "+972502345678"), CancellationToken.None);
        var sameNameAndBirth = await people.CreateAsync(owner, new NewPerson("noa levi", null, null, new DateOnly(1990, 5, 1), "other@example.com", null), CancellationToken.None);

        var reasons = await db.AsMasterAsync(
            "SELECT string_agg(reason, ',' ORDER BY reason) FROM people.duplicate_candidates WHERE organization_id = $1 AND status = 'open'",
            owner.OrganizationId);
        reasons.Should().Be("name_birth_date,phone");
        (await db.AsMasterAsync("SELECT count(*) FROM people.people WHERE organization_id = $1 AND status = 'active'", owner.OrganizationId))
            .Should().Be(4L, "three walk-ins plus the owner, nothing merged");
        new[] { first.Person.Id, samePhone.Person.Id, sameNameAndBirth.Person.Id }.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public async Task Contacts_KeepOnePrimaryPerType_AndTheLoginEmailIsLocked()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);
        var person = await people.CreateAsync(owner, new NewPerson("Noa", null, null, null, "noa@example.com", null), CancellationToken.None);

        var second = await people.AddContactAsync(owner, person.Person.Id, "email", "Noa.Work@Example.com", isPrimary: true, CancellationToken.None);
        var detail = await people.GetAsync(owner, person.Person.Id, CancellationToken.None);

        second.Value.Should().Be("noa.work@example.com");
        detail.ContactPoints.Where(c => c.Type == "email" && c.IsPrimary).Should().ContainSingle().Which.Id.Should().Be(second.Id);
        detail.Person.PrimaryEmail.Should().Be("noa.work@example.com");

        await people.DeleteContactAsync(owner, person.Person.Id, second.Id, CancellationToken.None);
        (await people.GetAsync(owner, person.Person.Id, CancellationToken.None)).Person.PrimaryEmail.Should().Be("noa@example.com", "the remaining email takes over as primary");

        var ownerRecord = (await people.ListAsync(owner, new PeopleQuery("owner-", null, null, 10), CancellationToken.None)).Items.Single();
        var loginEmail = (await people.GetAsync(owner, ownerRecord.Id, CancellationToken.None)).ContactPoints.Single();
        var edit = () => people.UpdateContactAsync(owner, ownerRecord.Id, loginEmail.Id, "new@example.com", false, null, CancellationToken.None);
        (await edit.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("contact_point.verified");
    }

    [Fact]
    public async Task Update_ChangesAndClearsFields_AndChecksTheVersion()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);
        var person = await people.CreateAsync(owner, new NewPerson("Noa", "Noa", "Levi", new DateOnly(1990, 5, 1), null, "0502345678"), CancellationToken.None);

        var updated = await people.UpdateAsync(
            owner,
            person.Person.Id,
            new PersonChanges("Noa L.", default, FieldChange.Set<string?>(null), FieldChange.Set<DateOnly?>(null), "archived"),
            person.Person.Version,
            CancellationToken.None);
        var stale = () => people.UpdateAsync(owner, person.Person.Id, new PersonChanges("X", default, default, default, null), person.Person.Version, CancellationToken.None);

        updated.Person.DisplayName.Should().Be("Noa L.");
        updated.Person.GivenName.Should().Be("Noa");
        updated.Person.FamilyName.Should().BeNull();
        updated.Person.BirthDate.Should().BeNull();
        updated.Person.Status.Should().Be("archived");
        (await stale.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("concurrency.conflict");
    }

    [Fact]
    public async Task People_OfAnotherStudioAreInvisible()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var ownerA = await StudioAsync(db, "studio-a");
        var ownerB = await StudioAsync(db, "studio-b");
        var people = new PeopleService(db);
        var inB = await people.CreateAsync(ownerB, new NewPerson("Noa", null, null, null, null, "0502345678"), CancellationToken.None);

        var read = () => people.GetAsync(ownerA, inB.Person.Id, CancellationToken.None);
        var listA = await people.ListAsync(ownerA, new PeopleQuery(null, null, null, 50), CancellationToken.None);

        (await read.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.not_found");
        listA.Items.Should().NotContain(p => p.Id == inB.Person.Id);
    }

    [Theory]
    [InlineData("050-234 5678")]
    [InlineData("0502345678")]
    [InlineData("+972502345678")]
    [InlineData("2345678")]
    public async Task Search_FindsAPhoneTypedTheWayFrontDesksTypeIt(string typed)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);
        var noa = await people.CreateAsync(owner, new NewPerson("Noa", null, null, null, null, "050-2345678"), CancellationToken.None);

        var found = await people.ListAsync(owner, new PeopleQuery(typed, null, null, 10), CancellationToken.None);

        found.Items.Should().ContainSingle().Which.Id.Should().Be(noa.Person.Id);
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db, string slug)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id,
            $"owner-{slug}@example.com");
        var account = new AccountSnapshot(id, AccountStatus.Active, true);
        var studio = await new OrganizationService(db).CreateAsync(account, new NewOrganization("Main", slug, null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }
}
