using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Studios and members (docs/26 sections 3, 4 and 8.2) against PostgreSQL 18
/// as `tempo_app`, so row-level security is in force throughout.
/// </summary>
public sealed class OrganizationServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Create_OpensTheStudioWithTheCallerAsOwner_AndAudits()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await AccountAsync(db, "owner@example.com");

        var studio = await new OrganizationService(db).CreateAsync(owner, new NewOrganization(" סטודיו נשימה ", "studio-neshima", null, null), "c-1", CancellationToken.None);

        studio.DisplayName.Should().Be("סטודיו נשימה");
        studio.TimeZone.Should().Be("Asia/Jerusalem");
        studio.CurrencyCode.Should().Be("ILS");
        studio.JoinLinkEnabled.Should().BeFalse();
        var membership = await new MembershipDirectory(db).FindAsync(owner.UserAccountId, studio.Id, CancellationToken.None);
        membership!.Role.Should().Be(MembershipRole.Owner);
        (await db.AsMasterAsync("SELECT string_agg(action, ',' ORDER BY action) FROM audit.audit_events WHERE organization_id = $1", studio.Id))
            .Should().Be("membership.created,organization.created");
    }

    [Fact]
    public async Task Create_RefusesAnUnverifiedEmail()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await AccountAsync(db, "owner@example.com", verified: false);

        var create = () => new OrganizationService(db).CreateAsync(owner, new NewOrganization("Studio", "studio-x", null, null), "c", CancellationToken.None);

        (await create.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("account.email_not_verified");
    }

    [Fact]
    public async Task Create_RefusesATakenSlug_AndTheFourthStudio()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new OrganizationService(db);
        var owner = await AccountAsync(db, "owner@example.com");
        var other = await AccountAsync(db, "other@example.com");
        await service.CreateAsync(owner, new NewOrganization("One", "studio-one", null, null), "c", CancellationToken.None);

        var taken = () => service.CreateAsync(other, new NewOrganization("Copy", "studio-one", null, null), "c", CancellationToken.None);
        (await taken.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("organization.slug_taken");

        await service.CreateAsync(owner, new NewOrganization("Two", "studio-two", null, null), "c", CancellationToken.None);
        await service.CreateAsync(owner, new NewOrganization("Three", "studio-three", null, null), "c", CancellationToken.None);
        var fourth = () => service.CreateAsync(owner, new NewOrganization("Four", "studio-four", null, null), "c", CancellationToken.None);
        (await fourth.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("organization.creation_limit");
    }

    [Theory]
    [InlineData("A", "studio-ok", null, "display_name.length")]
    [InlineData("Studio", "No_Caps", null, "slug.invalid")]
    [InlineData("Studio", "ab", null, "slug.invalid")]
    [InlineData("Studio", "studio-ok", "Mars/Olympus", "time_zone.unknown")]
    public async Task Create_ValidatesInput(string displayName, string slug, string? timeZone, string code)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await AccountAsync(db, "owner@example.com");

        var create = () => new OrganizationService(db).CreateAsync(owner, new NewOrganization(displayName, slug, timeZone, null), "c", CancellationToken.None);

        (await create.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be(code);
    }

    [Fact]
    public async Task Update_ChecksRoleAndVersion()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (service, owner, studio) = await StudioAsync(db);
        var staff = await JoinAsync(db, studio, "staff@example.com", MembershipRole.Staff);

        var asStaff = () => service.UpdateAsync(staff, new OrganizationChanges("Renamed", null, null), null, CancellationToken.None);
        (await asStaff.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");

        var updated = await service.UpdateAsync(owner, new OrganizationChanges("Renamed", null, "en-US"), studio.Version, CancellationToken.None);
        updated.DisplayName.Should().Be("Renamed");
        updated.Version.Should().Be(studio.Version + 1);

        var stale = () => service.UpdateAsync(owner, new OrganizationChanges("Again", null, null), studio.Version, CancellationToken.None);
        (await stale.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("concurrency.conflict");
    }

    [Fact]
    public async Task Members_ListNewestFirstInPages_WithFilters()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, owner, studio) = await StudioAsync(db);
        for (var i = 0; i < 4; i++)
        {
            await JoinAsync(db, studio, $"client{i}@example.com", MembershipRole.Client);
        }

        var members = new MemberService(db, new AccountProfiles(db));
        var first = await members.ListAsync(owner, new MemberQuery(null, null, null, 3), CancellationToken.None);
        var second = await members.ListAsync(owner, new MemberQuery(null, null, first.NextBefore, 3), CancellationToken.None);
        var clients = await members.ListAsync(owner, new MemberQuery(MembershipRole.Client, null, null, 50), CancellationToken.None);

        first.Items.Should().HaveCount(3);
        first.Items[0].Email.Should().Be("client3@example.com");
        second.Items.Should().HaveCount(2);
        second.NextBefore.Should().BeNull();
        second.Items[^1].Role.Should().Be(MembershipRole.Owner);
        clients.Items.Should().HaveCount(4).And.OnlyContain(m => m.Role == MembershipRole.Client);
    }

    [Fact]
    public async Task Members_ClientsCannotList()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, _, studio) = await StudioAsync(db);
        var client = await JoinAsync(db, studio, "client@example.com", MembershipRole.Client);

        var list = () => new MemberService(db, new AccountProfiles(db)).ListAsync(client, new MemberQuery(null, null, null, 50), CancellationToken.None);

        (await list.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
    }

    [Fact]
    public async Task Members_AdminChangesStaffButNotAdmins_AndEveryChangeIsAudited()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, _, studio) = await StudioAsync(db);
        var admin = await JoinAsync(db, studio, "admin@example.com", MembershipRole.Admin);
        var otherAdmin = await JoinAsync(db, studio, "admin2@example.com", MembershipRole.Admin);
        var staff = await JoinAsync(db, studio, "staff@example.com", MembershipRole.Staff);
        var members = new MemberService(db, new AccountProfiles(db));

        var changed = await members.UpdateAsync(admin, staff.MembershipId, MembershipRole.Client, MembershipStatus.Suspended, null, CancellationToken.None);
        var promote = () => members.UpdateAsync(admin, staff.MembershipId, MembershipRole.Admin, null, null, CancellationToken.None);
        var touchAdmin = () => members.UpdateAsync(admin, otherAdmin.MembershipId, null, MembershipStatus.Suspended, null, CancellationToken.None);

        changed.Role.Should().Be(MembershipRole.Client);
        changed.Status.Should().Be(MembershipStatus.Suspended);
        changed.Email.Should().Be("staff@example.com");
        (await promote.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("membership.forbidden_role_change");
        (await touchAdmin.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("membership.forbidden_role_change");
        (await db.AsMasterAsync("SELECT string_agg(action, ',' ORDER BY action) FROM audit.audit_events WHERE target_id = $1", staff.MembershipId))
            .Should().Be("membership.role_changed,membership.suspended");
    }

    [Fact]
    public async Task Members_LeaveAndRemove()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, owner, studio) = await StudioAsync(db);
        var staff = await JoinAsync(db, studio, "staff@example.com", MembershipRole.Staff);
        var client = await JoinAsync(db, studio, "client@example.com", MembershipRole.Client);
        var members = new MemberService(db, new AccountProfiles(db));

        var ownerLeaves = () => members.RemoveAsync(owner, owner.MembershipId, CancellationToken.None);
        var staffRemovesClient = () => members.RemoveAsync(staff, client.MembershipId, CancellationToken.None);
        (await ownerLeaves.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("membership.owner_cannot_leave");
        (await staffRemovesClient.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");

        await members.RemoveAsync(staff, staff.MembershipId, CancellationToken.None);
        await members.RemoveAsync(owner, client.MembershipId, CancellationToken.None);

        var again = () => members.RemoveAsync(owner, client.MembershipId, CancellationToken.None);
        (await again.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("membership.not_found");
        var left = await members.ListAsync(owner, new MemberQuery(null, null, null, 50), CancellationToken.None);
        left.Items.Should().ContainSingle().Which.Role.Should().Be(MembershipRole.Owner);
        var removed = await members.ListAsync(owner, new MemberQuery(null, MembershipStatus.Removed, null, 50), CancellationToken.None);
        removed.Items.Should().HaveCount(2);
    }

    [Fact]
    public async Task Members_OfAnotherStudioAreInvisible()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, ownerA, _) = await StudioAsync(db, "studio-a");
        var (_, _, studioB) = await StudioAsync(db, "studio-b");
        var clientB = await JoinAsync(db, studioB, "client@example.com", MembershipRole.Client);

        var crossTenant = () => new MemberService(db, new AccountProfiles(db)).RemoveAsync(ownerA, clientB.MembershipId, CancellationToken.None);

        (await crossTenant.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("membership.not_found");
    }

    private static async Task<(OrganizationService Service, TenantContext Owner, OrganizationView Studio)> StudioAsync(MigratedDatabase db, string slug = "studio-main")
    {
        var service = new OrganizationService(db);
        var owner = await AccountAsync(db, $"owner-{slug}@example.com");
        var studio = await service.CreateAsync(owner, new NewOrganization("Main", slug, null, null), "c", CancellationToken.None);
        var membership = await new MembershipDirectory(db).FindAsync(owner.UserAccountId, studio.Id, CancellationToken.None);
        return (service, Tenant(studio.Id, owner.UserAccountId, membership!.MembershipId, MembershipRole.Owner), studio);
    }

    private static async Task<TenantContext> JoinAsync(MigratedDatabase db, OrganizationView studio, string email, MembershipRole role)
    {
        var account = await AccountAsync(db, email);
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studio.Id,
            membershipId,
            account.UserAccountId,
            StoredValue.Of(role));
        return Tenant(studio.Id, account.UserAccountId, membershipId, role);
    }

    private static async Task<AccountSnapshot> AccountAsync(MigratedDatabase db, string email, bool verified = true)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, $3, now(), now(), now())",
            id,
            email,
            verified);
        return new AccountSnapshot(id, AccountStatus.Active, verified);
    }

    private static TenantContext Tenant(Guid organizationId, Guid accountId, Guid membershipId, MembershipRole role) =>
        new(organizationId, accountId, membershipId, role, OrganizationStatus.Active, "test");
}
