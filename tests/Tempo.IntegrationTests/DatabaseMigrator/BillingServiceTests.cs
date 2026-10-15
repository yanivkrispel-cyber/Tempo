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
