using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>Punch cards and memberships on PostgreSQL 18 (docs/29 section 5).</summary>
public sealed class PassServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Products_KeepTheirKindsApart()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var passes = new PassService(db, TimeProvider.System);

        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, 65000), CancellationToken.None);
        var monthly = await passes.CreateProductAsync(owner, new NewPassProduct("membership", "מנוי חודשי", null, 30, 3, "pilates", null), CancellationToken.None);

        card.Entries.Should().Be(10);
        monthly.WeeklyCap.Should().Be(3);
        var mixed = () => passes.CreateProductAsync(owner, new NewPassProduct("membership", "x", 5, 30, null, null, null), CancellationToken.None);
        (await mixed.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("entries.invalid");
        var cardWithCap = () => passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "x", 5, 30, 2, null, null), CancellationToken.None);
        (await cardWithCap.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("weeklyCap.invalid");
    }

    [Fact]
    public async Task AGrantedCard_ShowsItsEntries_ToStaffAndToTheMember()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var passes = new PassService(db, TimeProvider.System);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, null), CancellationToken.None);
        var me = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", owner.OrganizationId, owner.MembershipId))!;

        var granted = await passes.GrantAsync(owner, me, new NewPass(card.Id, null, "שולם במזומן"), CancellationToken.None);

        granted.EntriesLeft.Should().Be(10);
        granted.EndsOn.Should().Be(granted.StartsOn.AddDays(89), "valid for 90 days including the first");
        granted.Status.Should().Be("active");
        (await passes.ListMineAsync(owner, CancellationToken.None)).Should().ContainSingle().Which.Id.Should().Be(granted.Id);
        (await passes.ListForPersonAsync(owner, me, CancellationToken.None)).Should().ContainSingle();

        var voided = await passes.VoidAsync(owner, granted.Id, CancellationToken.None);
        voided.Status.Should().Be("voided");
        var again = () => passes.VoidAsync(owner, granted.Id, CancellationToken.None);
        (await again.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("pass.voided");

        var old = await passes.GrantAsync(owner, me, new NewPass(card.Id, DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-200), null), CancellationToken.None);
        old.Status.Should().Be("expired");
    }

    [Fact]
    public async Task ArchivedProducts_AreNotGranted_AndErasureClearsTheNote()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var passes = new PassService(db, TimeProvider.System);
        var people = new PeopleService(db);
        var walkIn = await people.CreateAsync(owner, new NewPerson("Dana", null, null, null, null, "050-2345678"), CancellationToken.None);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כניסה בודדת", 1, 30, null, null, null), CancellationToken.None);
        var pass = await passes.GrantAsync(owner, walkIn.Person.Id, new NewPass(card.Id, null, "Dana paid cash"), CancellationToken.None);

        await passes.ArchiveProductAsync(owner, card.Id, CancellationToken.None);
        var grant = () => passes.GrantAsync(owner, walkIn.Person.Id, new NewPass(card.Id, null, null), CancellationToken.None);
        (await grant.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("pass_product.archived");

        await new PersonLifecycleService(db, TimeProvider.System).EraseAsync(owner, walkIn.Person.Id, "Asked to be forgotten", CancellationToken.None);
        (await db.AsMasterAsync("SELECT note FROM scheduling.passes WHERE id = $1", pass.Id)).Should().Be(DBNull.Value);
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
