using FluentAssertions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// #245 (from #124 item 4): a role assignment uses a system role or a role of its own studio, never another
/// studio's, whoever writes it. Custom roles do not ship yet, so the test writes their rows directly.
/// </summary>
public sealed class RoleAssignmentScopeTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static readonly Guid StaffRole = Guid.Parse("00000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task AnAssignment_CannotUseAnotherStudiosRole_ButMayUseItsOwnOrASystemRole()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (studioA, membershipA) = await StudioAsync(db, "a");
        var (studioB, _) = await StudioAsync(db, "b");
        var roleA = await CustomRoleAsync(db, studioA);
        var roleB = await CustomRoleAsync(db, studioB);

        var foreign = () => AssignAsync(db, studioA, membershipA, roleB);
        (await foreign.Should().ThrowAsync<PostgresException>()).Which.ConstraintName.Should().Be("role_assignments_role_in_scope");

        await AssignAsync(db, studioA, membershipA, roleA);
        await AssignAsync(db, studioA, membershipA, StaffRole);

        var moved = () => db.AsMasterAsync("UPDATE authz.role_assignments SET role_id = $1 WHERE organization_id = $2 AND role_id = $3", roleB, studioA, roleA);
        (await moved.Should().ThrowAsync<PostgresException>()).Which.ConstraintName.Should().Be("role_assignments_role_in_scope");
    }

    private static Task<object?> AssignAsync(MigratedDatabase db, Guid organizationId, Guid membershipId, Guid roleId) =>
        db.AsMasterAsync(
            "INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            organizationId, Guid.CreateVersion7(), membershipId, roleId);

    private static async Task<Guid> CustomRoleAsync(MigratedDatabase db, Guid organizationId)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO authz.roles (id, organization_id, key, display_name, is_system, created_at, updated_at) VALUES ($1, $2, 'front_desk', 'קבלה', false, now(), now())",
            id, organizationId);
        return id;
    }

    private static async Task<(Guid Organization, Guid Membership)> StudioAsync(MigratedDatabase db, string slug)
    {
        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account, $"owner-{slug}@example.com");
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(account, AccountStatus.Active, true), new NewOrganization("Main", $"studio-{slug}", null, null), "c", CancellationToken.None);
        var membership = Guid.CreateVersion7();
        var staffAccount = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            staffAccount, $"staff-{slug}@example.com");
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'staff', 'active', now(), now())",
            studio.Id, membership, staffAccount);
        return (studio.Id, membership);
    }
}
