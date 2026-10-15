using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Organizations.Infrastructure;

/// <summary>
/// Keeps `authz.role_assignments` in step with `memberships.role` while the
/// Phase 1 column still exists (docs/27 section 3.3): every write that creates
/// a membership or changes its role or removes it calls this in the same
/// transaction. Phase 2 has system roles only, so a membership holds exactly one.
/// </summary>
public static class RoleAssignments
{
    /// <summary>Makes <paramref name="role"/>'s system role the membership's only live assignment.</summary>
    public static async Task SetSystemRoleAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid membershipId,
        MembershipRole role,
        Guid? grantedByMembershipId,
        CancellationToken cancellationToken)
    {
        var roleId = SystemRoles.Of(role).Id;
        await RevokeAsync(unitOfWork, organizationId, membershipId, roleId, cancellationToken);
        await using var insert = unitOfWork.Command(
            """
            INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, granted_by, created_at, updated_at)
            SELECT $1, $2, $3, $4, 'active', $5, now(), now()
            WHERE NOT EXISTS (
                SELECT 1 FROM authz.role_assignments
                WHERE organization_id = $1 AND membership_id = $3 AND role_id = $4 AND status = 'active'
            )
            """,
            organizationId,
            Guid.CreateVersion7(),
            membershipId,
            roleId,
            grantedByMembershipId);
        await insert.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Revokes every live assignment of a removed membership.</summary>
    public static Task RevokeAllAsync(UnitOfWork unitOfWork, Guid organizationId, Guid membershipId, CancellationToken cancellationToken) =>
        RevokeAsync(unitOfWork, organizationId, membershipId, keepRoleId: null, cancellationToken);

    private static async Task RevokeAsync(UnitOfWork unitOfWork, Guid organizationId, Guid membershipId, Guid? keepRoleId, CancellationToken cancellationToken)
    {
        await using var revoke = unitOfWork.Command(
            """
            UPDATE authz.role_assignments
            SET status = 'revoked', updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND membership_id = $2 AND status = 'active'
              AND ($3::uuid IS NULL OR role_id <> $3)
            """,
            organizationId,
            membershipId,
            keepRoleId);
        await revoke.ExecuteNonQueryAsync(cancellationToken);
    }
}
