using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Platform.Modules.Organizations.Infrastructure;

/// <summary>
/// Joining a studio, shared by invitation acceptance and the join link. Runs
/// inside the caller's unit of work, after it has moved to the studio's tenant.
/// </summary>
internal static class MembershipQueries
{
    /// <summary>
    /// The caller's live membership in the current tenant: an existing active
    /// one is returned as it is (accepting twice is idempotent), a suspended
    /// one is refused, and otherwise a new active membership is created.
    /// </summary>
    public static async Task<(AccountMembership Membership, bool Created)> JoinAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid userAccountId,
        MembershipRole role,
        CancellationToken cancellationToken,
        string source = "join_link")
    {
        await using (var studio = unitOfWork.Command("SELECT status FROM organizations.organizations WHERE id = $1", organizationId))
        {
            if (await studio.ExecuteScalarAsync(cancellationToken) is not string status)
            {
                throw new InvalidOperationException("The studio is not visible inside its own tenant.");
            }

            if (StoredValue.Parse<OrganizationStatus>(status) == OrganizationStatus.Suspended)
            {
                throw new DomainRuleViolationException(ViolationKind.Forbidden, "organization.suspended", "This studio is suspended.");
            }
        }

        var existing = await FindLiveAsync(unitOfWork, organizationId, userAccountId, cancellationToken);
        if (existing is not null)
        {
            return existing.Status == MembershipStatus.Suspended
                ? throw new DomainRuleViolationException(ViolationKind.Forbidden, "membership.suspended", "Your membership in this studio is suspended.")
                : (existing, false);
        }

        var membershipId = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'active', now(), now())
            """,
            organizationId,
            membershipId,
            userAccountId,
            StoredValue.Of(role)))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await RoleAssignments.SetSystemRoleAsync(unitOfWork, organizationId, membershipId, role, null, cancellationToken);
        await PersonLinks.EnsureForMembershipAsync(unitOfWork, organizationId, membershipId, userAccountId, source, cancellationToken);

        return ((await FindLiveAsync(unitOfWork, organizationId, userAccountId, cancellationToken))!, true);
    }

    public static async Task<AccountMembership?> FindLiveAsync(UnitOfWork unitOfWork, Guid organizationId, Guid userAccountId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT m.id, m.role, m.status, o.id, o.slug, o.display_name, o.status
            FROM organizations.memberships m
            JOIN organizations.organizations o ON o.id = m.organization_id
            WHERE m.organization_id = $1 AND m.user_account_id = $2 AND m.status <> 'removed'
            """,
            organizationId,
            userAccountId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AccountMembership(
            reader.GetGuid(0),
            StoredValue.Parse<MembershipRole>(reader.GetString(1)),
            StoredValue.Parse<MembershipStatus>(reader.GetString(2)),
            reader.GetGuid(3),
            reader.GetString(4),
            reader.GetString(5),
            StoredValue.Parse<OrganizationStatus>(reader.GetString(6)));
    }

    public static Task AuditAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid actorId,
        string action,
        string targetType,
        Guid targetId,
        string correlationId,
        object? data,
        CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(organizationId, "user", actorId, action, targetType, targetId, correlationId, data),
            cancellationToken);
}
