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
/// Inviting a recorded person to the app (docs/27 section 4.5, migration 0008):
/// the invitation carries the person, and accepting it links the login to that
/// record even when the email was not on it before.
/// </summary>
public sealed class InvitePersonTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task AcceptingAnInvitationForAWalkIn_LinksThatRecord()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var walkIn = await people.CreateAsync(owner, new NewPerson("Dana (front desk)", null, null, null, null, "050-2345678"), CancellationToken.None);

        var email = await people.PrepareInvitationAsync(owner, walkIn.Person.Id, "Dana@Example.com", CancellationToken.None);
        var invitations = new InvitationService(db, new AccountProfiles(db), new AttemptLimiter(db));
        var created = await invitations.CreateAsync(owner, email, MembershipRole.Client, CancellationToken.None, walkIn.Person.Id);
        var account = await AccountAsync(db, "dana@example.com");
        await invitations.AcceptAsync(new AccountSnapshot(account, AccountStatus.Active, true), created.Token, "c", CancellationToken.None);

        var linked = await people.GetAsync(owner, walkIn.Person.Id, CancellationToken.None);
        linked.Person.HasLogin.Should().BeTrue();
        linked.ContactPoints.Single(c => c.Type == "email").Verified.Should().BeTrue();
        (await db.AsMasterAsync("SELECT count(*) FROM people.people WHERE organization_id = $1", owner.OrganizationId))
            .Should().Be(2L, "the owner and Dana, no second record");
        (await db.AsMasterAsync("SELECT person_id FROM organizations.invitations WHERE id = $1", created.Invitation.Id)).Should().Be(walkIn.Person.Id);
    }

    [Fact]
    public async Task APersonWhoAlreadySignsIn_CannotBeInvited()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var people = new PeopleService(db);
        var ownerRecord = (await people.ListAsync(owner, new PeopleQuery("owner@", null, null, 10), CancellationToken.None)).Items.Single();

        var invite = () => people.PrepareInvitationAsync(owner, ownerRecord.Id, "other@example.com", CancellationToken.None);

        (await invite.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.has_login");
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db)
    {
        var id = await AccountAsync(db, "owner@example.com");
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
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
