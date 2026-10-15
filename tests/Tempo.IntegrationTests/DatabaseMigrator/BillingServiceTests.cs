using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Billing;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>Thin billing on PostgreSQL 18 (docs/28, Kris's plan of 2026-10-15).</summary>
public sealed class BillingServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task ANewStudio_IsOnTheActiveFreePilotPlan()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);

        var billing = await new BillingService(db).GetAsync(owner, CancellationToken.None);

        billing.State.Should().Be("active", "a trial would restrict the pilot after 30 days");
        billing.Plan.PlanKey.Should().Be("pilot");
        billing.Plan.PriceMinor.Should().Be(0);
        billing.Provider.Should().Be("manual");
        billing.Entitlements["rooms.max"].GetInt32().Should().Be(20);
        (await db.AsMasterAsync("SELECT cause FROM billing.subscription_events WHERE organization_id = $1", owner.OrganizationId)).Should().Be("studio_created");
    }

    [Fact]
    public async Task TheOwner_KeepsBillingDetails_AuditedByFieldName()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var service = new BillingService(db);

        var updated = await service.UpdateAccountAsync(owner, new BillingAccountChanges("billing@example.com", "סטודיו נשימה בע\"מ", "515151515"), null, CancellationToken.None);

        updated.LegalName.Should().Be("סטודיו נשימה בע\"מ");
        updated.BusinessId.Should().Be("515151515");
        (await db.AsMasterAsync("SELECT data::text FROM audit.audit_events WHERE action = 'billing_account.updated'") as string)
            .Should().Contain("legalName").And.NotContain("515151515");
        var invalid = () => service.UpdateAccountAsync(owner, new BillingAccountChanges(null, null, "12"), null, CancellationToken.None);
        (await invalid.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("businessId.invalid");
    }

    [Fact]
    public async Task ARoomAboveThePlanLimit_IsRefused_AndAnOverrideRaisesIt()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        await db.AsMasterAsync(
            "INSERT INTO billing.entitlement_overrides (organization_id, key, value, reason, created_by_operator, created_at) VALUES ($1, 'rooms.max', '1', 'test', $2, now())",
            owner.OrganizationId, Guid.CreateVersion7());

        await timetable.CreateRoomAsync(owner, new NewRoom("Main hall", 20), CancellationToken.None);
        var second = () => timetable.CreateRoomAsync(owner, new NewRoom("Small room", 6), CancellationToken.None);

        (await second.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("entitlement.limit_reached");
        await db.AsMasterAsync("UPDATE billing.entitlement_overrides SET value = '2' WHERE organization_id = $1", owner.OrganizationId);
        (await second()).Name.Should().Be("Small room");
    }

    [Fact]
    public async Task ParallelCreations_StopAtTheLimit_AndUnarchivingCountsAsCreating()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var timetable = new TimetableService(db, TimeProvider.System);
        await db.AsMasterAsync(
            "INSERT INTO billing.entitlement_overrides (organization_id, key, value, reason, created_by_operator, created_at) VALUES ($1, 'rooms.max', '2', 'test', $2, now())",
            owner.OrganizationId, Guid.CreateVersion7());

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(i => Task.Run(async () =>
        {
            try
            {
                await timetable.CreateRoomAsync(owner, new NewRoom($"Room {i}", 8), CancellationToken.None);
                return "created";
            }
            catch (DomainRuleViolationException e)
            {
                return e.Code;
            }
        })));

        results.Count(r => r == "created").Should().Be(2);
        results.Where(r => r != "created").Should().OnlyContain(r => r == "entitlement.limit_reached");
        var rooms = await timetable.ListRoomsAsync(owner, CancellationToken.None);
        await timetable.UpdateRoomAsync(owner, rooms[0].Id, new RoomChanges(null, null, "archived"), null, CancellationToken.None);
        await timetable.CreateRoomAsync(owner, new NewRoom("Replacement", 8), CancellationToken.None);
        var reactivate = () => timetable.UpdateRoomAsync(owner, rooms[0].Id, new RoomChanges(null, null, "active"), null, CancellationToken.None);
        var limit = (await reactivate.Should().ThrowAsync<DomainRuleViolationException>()).Which;
        limit.Code.Should().Be("entitlement.limit_reached");
        limit.Extensions!["key"].Should().Be("rooms.max");
        limit.Extensions["limit"].Should().Be(2L);
        await timetable.UpdateRoomAsync(owner, rooms[1].Id, new RoomChanges("Renamed", null, "active"), null, CancellationToken.None);
    }

    [Fact]
    public async Task StaffInvitations_StopAtStaffMax_AndMeCarriesTheSubscription()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        await db.AsMasterAsync(
            "INSERT INTO billing.entitlement_overrides (organization_id, key, value, reason, created_by_operator, created_at) VALUES ($1, 'staff.max', '2', 'test', $2, now())",
            owner.OrganizationId, Guid.CreateVersion7());
        var invitations = new InvitationService(db, new Tempo.Platform.Modules.Identity.Infrastructure.AccountProfiles(db), new Tempo.Platform.Modules.Identity.Infrastructure.AttemptLimiter(db));

        await invitations.CreateAsync(owner, "staff@example.com", MembershipRole.Staff, CancellationToken.None);
        var second = () => invitations.CreateAsync(owner, "admin@example.com", MembershipRole.Admin, CancellationToken.None);
        (await second.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("entitlement.limit_reached");
        await invitations.CreateAsync(owner, "client@example.com", MembershipRole.Client, CancellationToken.None);

        var mine = (await new MembershipDirectory(db).ListForAccountAsync(owner.UserAccountId, CancellationToken.None)).Single();
        mine.SubscriptionState.Should().Be("active");
        mine.EntitlementsJson.Should().Contain("\"staff.max\": 2").And.Contain("\"rooms.max\": 20");
    }

    [Fact]
    public async Task OnlyOwnersAndAdmins_SeeBilling_AndOnlyOwnersChangeIt()
    {
        SystemRoles.Owner.Permissions.Should().Contain([Permissions.BillingView, Permissions.BillingManage]);
        SystemRoles.Admin.Permissions.Should().Contain(Permissions.BillingView).And.NotContain(Permissions.BillingManage);
        SystemRoles.Staff.Permissions.Should().NotContain(Permissions.BillingView);

        await using var db = await MigratedDatabase.CreateAsync(postgres);
        (await db.AsMasterAsync("SELECT count(*) FROM authz.role_permissions WHERE permission_key LIKE 'billing.%'")).Should().Be(3L);
        (await new BillingService(db).ListPublicPlansAsync(CancellationToken.None)).Should().BeEmpty("the pilot plan is not public");
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
