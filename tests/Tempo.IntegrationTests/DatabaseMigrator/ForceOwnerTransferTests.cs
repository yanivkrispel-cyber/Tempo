using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.PlatformAdmin;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The operators' forced owner transfer (docs/27 section 3.5) as `tempo_platform`
/// on PostgreSQL 18: only to an active admin, with a reason and a ticket, both
/// tables swapped, audited with the operator as actor.
/// </summary>
public sealed class ForceOwnerTransferTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static readonly OperatorContext Operator = new(Guid.CreateVersion7(), "kris@example.com", "c-op");

    [Fact]
    public async Task Force_MakesTheAdminOwner_AndAuditsReasonAndTicket()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (studio, owner, admin, _) = await StudioAsync(db);

        var after = await new PlatformService(db).ForceOwnerTransferAsync(Operator, studio, admin, "Owner unreachable for 30 days", "SUP-1042", CancellationToken.None);

        after.OwnerEmail.Should().Be("admin@example.com");
        (await RolesAsync(db, owner)).Should().Be(("admin", "admin"));
        (await RolesAsync(db, admin)).Should().Be(("owner", "owner"));
        // The ticket and the reason live in the operators' notes, not in the studio's audit log (#124).
        var audit = await db.AsMasterAsync(
            "SELECT actor_type || ' ' || coalesce(data->>'ticket', '-') || ' ' || (data->>'noteId' IS NOT NULL)::text FROM audit.audit_events WHERE organization_id = $1 AND action = 'ownership.transferred_by_operator'",
            studio);
        audit.Should().Be("operator - true");
        (await db.AsMasterAsync("SELECT reason || ' / ' || ticket FROM platform_admin.operator_notes WHERE organization_id = $1", studio))
            .Should().Be("Owner unreachable for 30 days / SUP-1042");
    }

    [Fact]
    public async Task Force_GoesOnlyToAnActiveAdmin_WithAReasonAndATicket()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (studio, _, admin, staff) = await StudioAsync(db);
        var platform = new PlatformService(db);

        var toStaff = () => platform.ForceOwnerTransferAsync(Operator, studio, staff, "Owner unreachable", "SUP-1", CancellationToken.None);
        var noTicket = () => platform.ForceOwnerTransferAsync(Operator, studio, admin, "Owner unreachable", " ", CancellationToken.None);
        var shortReason = () => platform.ForceOwnerTransferAsync(Operator, studio, admin, "no", "SUP-1", CancellationToken.None);

        (await toStaff.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ownership.target_not_admin");
        (await noTicket.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("ticket.required");
        (await shortReason.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("reason.length");
    }

    private static async Task<(Guid Studio, Guid Owner, Guid Admin, Guid Staff)> StudioAsync(MigratedDatabase db)
    {
        var ownerAccount = await AccountAsync(db, "owner@example.com");
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(ownerAccount, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var owner = (await new MembershipDirectory(db).FindAsync(ownerAccount, studio.Id, CancellationToken.None))!.MembershipId;
        return (studio.Id, owner, await MemberAsync(db, studio.Id, "admin@example.com", MembershipRole.Admin), await MemberAsync(db, studio.Id, "staff@example.com", MembershipRole.Staff));
    }

    private static async Task<Guid> MemberAsync(MigratedDatabase db, Guid studio, string email, MembershipRole role)
    {
        var account = await AccountAsync(db, email);
        var membership = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studio, membership, account, StoredValue.Of(role));
        await db.AsMasterAsync(
            "INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studio, Guid.CreateVersion7(), membership, SystemRoles.Of(role).Id);
        return membership;
    }

    private static async Task<Guid> AccountAsync(MigratedDatabase db, string email)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id, email);
        return id;
    }

    private static async Task<(string Membership, string Assignment)> RolesAsync(MigratedDatabase db, Guid membership) =>
        ((string)(await db.AsMasterAsync("SELECT role FROM organizations.memberships WHERE id = $1", membership))!,
         (string)(await db.AsMasterAsync(
             "SELECT string_agg(r.key, ',') FROM authz.role_assignments a JOIN authz.roles r ON r.id = a.role_id WHERE a.membership_id = $1 AND a.status = 'active'",
             membership))!);
}
