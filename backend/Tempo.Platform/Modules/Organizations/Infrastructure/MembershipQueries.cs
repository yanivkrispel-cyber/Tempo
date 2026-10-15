using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Organizations.Domain;
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
        string source = "join_link",
        Guid? personId = null)
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
        await PersonLinks.EnsureForMembershipAsync(unitOfWork, organizationId, membershipId, userAccountId, source, cancellationToken, personId);

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

    /// <summary>
    /// Revokes the pending invitations a member sent that they could not send now (#121): all of them when the
    /// member is removed or suspended (<paramref name="inviterRole"/> null), otherwise those whose role the new
    /// role may not invite. Each gets its own `invitation.revoked` with the reason.
    /// </summary>
    public static async Task RevokeInvitationsSentByAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid inviterMembershipId,
        MembershipRole? inviterRole,
        Guid actorId,
        string correlationId,
        string reason,
        CancellationToken cancellationToken)
    {
        string[] stillAllowed = inviterRole is { } role
            ? [.. Enum.GetValues<MembershipRole>().Where(invited => RolePolicy.CanInvite(role, invited)).Select(invited => StoredValue.Of(invited))]
            : [];
        var revoked = new List<Guid>();
        await using (var command = unitOfWork.Command(
            """
            UPDATE organizations.invitations
            SET status = 'revoked', updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND invited_by_membership_id = $2 AND status = 'pending' AND NOT (role = ANY($3))
            RETURNING id
            """,
            organizationId,
            inviterMembershipId,
            stillAllowed))
        {
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                revoked.Add(reader.GetGuid(0));
            }
        }

        foreach (var id in revoked)
        {
            await AuditAsync(unitOfWork, organizationId, actorId, "invitation.revoked", "invitation", id, correlationId, new { reason }, cancellationToken);
        }
    }

    /// <summary>True when the member who sent the invitation is still active and may still invite its role (#121).</summary>
    public static async Task<bool> InviterStillMayInviteAsync(UnitOfWork unitOfWork, Guid organizationId, Guid invitationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT i.role, m.role, m.status
            FROM organizations.invitations i
            JOIN organizations.memberships m ON m.organization_id = i.organization_id AND m.id = i.invited_by_membership_id
            WHERE i.organization_id = $1 AND i.id = $2
            """,
            organizationId,
            invitationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            && reader.GetString(2) == StoredValue.Of(MembershipStatus.Active)
            && RolePolicy.CanInvite(StoredValue.Parse<MembershipRole>(reader.GetString(1)), StoredValue.Parse<MembershipRole>(reader.GetString(0)));
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
