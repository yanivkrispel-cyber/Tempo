using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.PlatformAdmin;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The operator console as `tempo_platform` and a studio's audit log as
/// `tempo_app` (docs/26 sections 8.2, 8.4, 9 and 10.1).
/// </summary>
public sealed class PlatformServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string OperatorIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Operators";

    [Fact]
    public async Task Operators_AreFoundBySubject_OnlyWhenActive()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var platform = new PlatformService(db);
        var kris = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO platform_admin.operators (id, email, issuer, subject, status, created_at, updated_at) VALUES ($1, 'kris@example.com', $2, 'sub-kris', 'active', now(), now())",
            kris,
            OperatorIssuer);
        await db.AsMasterAsync(
            "INSERT INTO platform_admin.operators (id, email, issuer, subject, status, created_at, updated_at) VALUES ($1, 'gone@example.com', $2, 'sub-gone', 'disabled', now(), now())",
            Guid.CreateVersion7(),
            OperatorIssuer);

        (await platform.FindActiveAsync(OperatorIssuer, "sub-kris", CancellationToken.None)).Should().Be((kris, "kris@example.com"));
        (await platform.FindActiveAsync(OperatorIssuer, "sub-gone", CancellationToken.None)).Should().BeNull();
        (await platform.FindActiveAsync("https://other", "sub-kris", CancellationToken.None)).Should().BeNull();
    }

    [Fact]
    public async Task Console_SeesEveryStudioWithCounts_AndAuditsReadsAndSuspension()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var platform = new PlatformService(db);
        var studioA = await StudioAsync(db, "studio-a", clients: 2);
        await StudioAsync(db, "studio-b", clients: 0);
        var caller = new OperatorContext(Guid.CreateVersion7(), "kris@example.com", "c-op");

        var all = await platform.ListAsync(null, null, 50, CancellationToken.None);
        var one = await platform.GetAsync(caller, studioA, CancellationToken.None);
        var suspended = await platform.SetStatusAsync(caller, studioA, OrganizationStatus.Suspended, "abuse report", CancellationToken.None);
        var again = await platform.SetStatusAsync(caller, studioA, OrganizationStatus.Suspended, "abuse report", CancellationToken.None);
        var onlySuspended = await platform.ListAsync(OrganizationStatus.Suspended, null, 50, CancellationToken.None);
        var stats = await platform.StatsAsync(CancellationToken.None);

        all.Items.Should().HaveCount(2);
        one.MemberCounts.Should().Be(new MemberCounts(1, 0, 0, 2));
        one.OwnerEmail.Should().Be("owner-studio-a@example.com");
        suspended.Status.Should().Be(OrganizationStatus.Suspended);
        again.Status.Should().Be(OrganizationStatus.Suspended);
        onlySuspended.Items.Should().ContainSingle().Which.Id.Should().Be(studioA);
        stats.Should().Be(new PlatformStats(1, 1, 4, 4, 10));
        (await db.AsMasterAsync(
                "SELECT string_agg(action, ',' ORDER BY action) FROM audit.audit_events WHERE organization_id = $1 AND actor_type = 'operator' AND actor_id = $2",
                studioA,
                caller.OperatorId))
            .Should().Be("organization.suspended,organization.viewed_by_operator", "the second suspend changes nothing and writes nothing");
    }

    [Fact]
    public async Task Console_RequiresAReason()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a", clients: 0);

        var suspend = () => new PlatformService(db).SetStatusAsync(new OperatorContext(Guid.CreateVersion7(), "k", "c"), studio, OrganizationStatus.Suspended, " no ", CancellationToken.None);

        (await suspend.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("reason.length");
    }

    [Fact]
    public async Task AuditLog_ShowsTheStudiosEventsWithNames_ToOwnersAndAdminsOnly()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await AccountAsync(db, "owner@example.com", "Dana");
        var studio = await new OrganizationService(db).CreateAsync(owner, new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var otherOwner = await AccountAsync(db, "other@example.com", null);
        await new OrganizationService(db).CreateAsync(otherOwner, new NewOrganization("Other", "studio-other", null, null), "c", CancellationToken.None);
        var membership = await new MembershipDirectory(db).FindAsync(owner.UserAccountId, studio.Id, CancellationToken.None);
        var audit = new AuditService(db, new AccountProfiles(db));
        var asOwner = new TenantContext(studio.Id, owner.UserAccountId, membership!.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "c");

        var page = await audit.ListAsync(asOwner, null, 1, CancellationToken.None);
        var rest = await audit.ListAsync(asOwner, page.NextBefore, 50, CancellationToken.None);
        var asStaff = () => audit.ListAsync(asOwner with { Role = MembershipRole.Staff }, null, 50, CancellationToken.None);

        page.Items.Should().ContainSingle();
        rest.Items.Should().ContainSingle();
        rest.NextBefore.Should().BeNull("the other studio's two events are not visible");
        page.Items.Concat(rest.Items).Select(e => e.Action).Should().BeEquivalentTo("organization.created", "membership.created");
        page.Items[0].ActorDisplayName.Should().Be("Dana");
        (await asStaff.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
    }

    private static async Task<Guid> StudioAsync(MigratedDatabase db, string slug, int clients)
    {
        var owner = await AccountAsync(db, $"owner-{slug}@example.com", null);
        var studio = await new OrganizationService(db).CreateAsync(owner, new NewOrganization(slug, slug, null, null), "c", CancellationToken.None);
        for (var i = 0; i < clients; i++)
        {
            var client = await AccountAsync(db, $"client{i}-{slug}@example.com", null);
            await db.AsMasterAsync(
                "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', 'active', now(), now())",
                studio.Id,
                Guid.CreateVersion7(),
                client.UserAccountId);
        }

        return studio.Id;
    }

    private static async Task<AccountSnapshot> AccountAsync(MigratedDatabase db, string email, string? displayName)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, display_name, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, $3, now(), now(), now())",
            id,
            email,
            displayName);
        return new AccountSnapshot(id, AccountStatus.Active, true);
    }
}
