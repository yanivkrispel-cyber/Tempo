using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Owner transfer (docs/27 section 3.5) against PostgreSQL 18 as `tempo_app`:
/// only an active admin can receive the studio, one pending transfer per
/// studio, acceptance swaps owner and admin in both memberships and role
/// assignments, and an offer expires after 72 hours.
/// </summary>
public sealed class OwnershipServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Accept_MakesTheAdminOwnerAndTheOwnerAdmin()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var clock = new FixedClock(DateTimeOffset.UtcNow);
        var (owner, admin, _) = await StudioWithAdminAndStaffAsync(db);
        var service = new OwnershipService(db, clock);

        var started = await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);
        (await service.GetPendingAsync(admin, CancellationToken.None)).Id.Should().Be(started.Id);
        await service.AcceptAsync(admin, CancellationToken.None);

        (await RoleOfAsync(db, owner.MembershipId)).Should().Be(("admin", "admin"));
        (await RoleOfAsync(db, admin.MembershipId)).Should().Be(("owner", "owner"));
        var newOwner = await new MembershipDirectory(db).FindAsync(admin.UserAccountId, admin.OrganizationId, CancellationToken.None);
        newOwner!.Permissions.Should().Contain(Permissions.OwnershipTransfer);
        (await db.AsMasterAsync("SELECT status FROM organizations.ownership_transfers WHERE id = $1", started.Id)).Should().Be("accepted");
        (await db.AsMasterAsync("SELECT string_agg(action, ',' ORDER BY action) FROM audit.audit_events WHERE target_id = $1", started.Id))
            .Should().Be("ownership.transfer_started,ownership.transferred");
    }

    [Fact]
    public async Task Start_GoesOnlyToAnActiveAdmin_AndOnlyOneAtATime()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, admin, staff) = await StudioWithAdminAndStaffAsync(db);
        var service = new OwnershipService(db, new FixedClock(DateTimeOffset.UtcNow));

        var toStaff = () => service.StartAsync(owner, staff.MembershipId, CancellationToken.None);
        (await toStaff.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.target_not_admin");

        await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);
        var again = () => service.StartAsync(owner, admin.MembershipId, CancellationToken.None);
        (await again.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.transfer_pending");

        var byAdmin = () => service.StartAsync(admin, owner.MembershipId, CancellationToken.None);
        (await byAdmin.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
    }

    [Fact]
    public async Task StaffCannotSeeOrAnswerSomeoneElsesTransfer()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, admin, staff) = await StudioWithAdminAndStaffAsync(db);
        var service = new OwnershipService(db, new FixedClock(DateTimeOffset.UtcNow));
        await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);

        var look = () => service.GetPendingAsync(staff, CancellationToken.None);
        var accept = () => service.AcceptAsync(staff, CancellationToken.None);
        var ownerAccepts = () => service.AcceptAsync(owner, CancellationToken.None);

        (await look.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.transfer_not_found");
        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.transfer_not_found");
        (await ownerAccepts.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.transfer_not_found");
    }

    [Fact]
    public async Task DeclineAndCancel_LeaveTheRolesAlone()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, admin, _) = await StudioWithAdminAndStaffAsync(db);
        var service = new OwnershipService(db, new FixedClock(DateTimeOffset.UtcNow));

        await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);
        await service.DeclineAsync(admin, CancellationToken.None);
        await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);
        await service.CancelAsync(owner, CancellationToken.None);

        (await RoleOfAsync(db, owner.MembershipId)).Should().Be(("owner", "owner"));
        (await db.AsMasterAsync("SELECT string_agg(status, ',' ORDER BY created_at) FROM organizations.ownership_transfers WHERE organization_id = $1", owner.OrganizationId))
            .Should().Be("declined,cancelled");
    }

    [Fact]
    public async Task Accept_AfterTheTargetWasDemoted_IsStale_AndChangesNothing()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, admin, _) = await StudioWithAdminAndStaffAsync(db);
        var service = new OwnershipService(db, new FixedClock(DateTimeOffset.UtcNow));
        var started = await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);

        await new MemberService(db, new Tempo.Platform.Modules.Identity.Infrastructure.AccountProfiles(db))
            .UpdateAsync(owner, admin.MembershipId, MembershipRole.Staff, null, null, CancellationToken.None);
        var accept = () => service.AcceptAsync(admin with { Role = MembershipRole.Staff }, CancellationToken.None);

        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.transfer_stale");
        (await RoleOfAsync(db, owner.MembershipId)).Should().Be(("owner", "owner"));
        (await RoleOfAsync(db, admin.MembershipId)).Should().Be(("staff", "staff"));
        (await db.AsMasterAsync("SELECT status FROM organizations.ownership_transfers WHERE id = $1", started.Id)).Should().Be("cancelled");
    }

    [Fact]
    public async Task Accept_After72Hours_IsGone()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var clock = new FixedClock(DateTimeOffset.UtcNow);
        var (owner, admin, _) = await StudioWithAdminAndStaffAsync(db);
        var service = new OwnershipService(db, clock);
        await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);

        clock.Now += TimeSpan.FromHours(73);
        var accept = () => service.AcceptAsync(admin, CancellationToken.None);

        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.transfer_expired");
        (await RoleOfAsync(db, owner.MembershipId)).Should().Be(("owner", "owner"));
        await service.StartAsync(owner, admin.MembershipId, CancellationToken.None);
    }

    private static async Task<(TenantContext Owner, TenantContext Admin, TenantContext Staff)> StudioWithAdminAndStaffAsync(MigratedDatabase db)
    {
        var ownerAccount = await AccountAsync(db, "owner@example.com");
        var studio = await new OrganizationService(db).CreateAsync(ownerAccount, new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var ownerMembership = (await new MembershipDirectory(db).FindAsync(ownerAccount.UserAccountId, studio.Id, CancellationToken.None))!;
        var owner = Tenant(studio.Id, ownerAccount.UserAccountId, ownerMembership.MembershipId, MembershipRole.Owner);
        return (owner, await MemberAsync(db, studio.Id, "admin@example.com", MembershipRole.Admin), await MemberAsync(db, studio.Id, "staff@example.com", MembershipRole.Staff));
    }

    private static async Task<TenantContext> MemberAsync(MigratedDatabase db, Guid organizationId, string email, MembershipRole role)
    {
        var account = await AccountAsync(db, email);
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            organizationId,
            membershipId,
            account.UserAccountId,
            StoredValue.Of(role));
        await db.AsMasterAsync(
            "INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            organizationId,
            Guid.CreateVersion7(),
            membershipId,
            SystemRoles.Of(role).Id);
        return Tenant(organizationId, account.UserAccountId, membershipId, role);
    }

    private static async Task<(string Membership, string Assignment)> RoleOfAsync(MigratedDatabase db, Guid membershipId)
    {
        var membership = (string)(await db.AsMasterAsync("SELECT role FROM organizations.memberships WHERE id = $1", membershipId))!;
        var assignment = (string)(await db.AsMasterAsync(
            "SELECT string_agg(r.key, ',') FROM authz.role_assignments a JOIN authz.roles r ON r.id = a.role_id WHERE a.membership_id = $1 AND a.status = 'active'",
            membershipId))!;
        return (membership, assignment);
    }

    private static async Task<AccountSnapshot> AccountAsync(MigratedDatabase db, string email)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id,
            email);
        return new AccountSnapshot(id, AccountStatus.Active, true);
    }

    private static TenantContext Tenant(Guid organizationId, Guid accountId, Guid membershipId, MembershipRole role) =>
        new(organizationId, accountId, membershipId, role, OrganizationStatus.Active, "test");

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
