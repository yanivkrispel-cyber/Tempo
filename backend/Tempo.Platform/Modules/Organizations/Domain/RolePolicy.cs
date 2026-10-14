using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Organizations.Domain;

/// <summary>
/// The fixed role rules of Phase 1 (docs/26 section 4.1 and the route table
/// in section 8.2). Pure functions, so every cell of the table has a unit test.
/// Phase 2 replaces this with role assignments and permissions.
/// </summary>
public static class RolePolicy
{
    /// <summary>GET the studio: any member (section 8.2).</summary>
    public static bool CanViewOrganization(MembershipRole actor) => true;

    public static bool CanEditOrganization(MembershipRole actor) => actor is MembershipRole.Owner or MembershipRole.Admin;

    public static bool CanListMembers(MembershipRole actor) => actor is MembershipRole.Owner or MembershipRole.Admin or MembershipRole.Staff;

    public static bool CanViewAudit(MembershipRole actor) => actor is MembershipRole.Owner or MembershipRole.Admin;

    public static bool CanManageJoinLink(MembershipRole actor) => actor is MembershipRole.Owner or MembershipRole.Admin;

    /// <summary>List and revoke invitations (section 8.2). Which roles one may invite is <see cref="CanInvite"/>.</summary>
    public static bool CanManageInvitations(MembershipRole actor) => actor is MembershipRole.Owner or MembershipRole.Admin;

    /// <summary>Owners invite admins, staff and clients; admins invite staff and clients. Nobody invites an owner.</summary>
    public static bool CanInvite(MembershipRole actor, MembershipRole invited) => (actor, invited) switch
    {
        (_, MembershipRole.Owner) => false,
        (MembershipRole.Owner, _) => true,
        (MembershipRole.Admin, MembershipRole.Staff or MembershipRole.Client) => true,
        _ => false
    };

    /// <summary>
    /// Changing a member's role or status: the owner may change anyone but
    /// themselves; an admin only staff and clients, and only to staff or
    /// client. Nobody grants the owner role (section 4.1 rules).
    /// </summary>
    public static bool CanChangeMember(MembershipRole actor, bool isSelf, MembershipRole target, MembershipRole? newRole)
    {
        if (isSelf || target == MembershipRole.Owner || newRole == MembershipRole.Owner)
        {
            return false;
        }

        return actor switch
        {
            MembershipRole.Owner => true,
            MembershipRole.Admin => IsStaffOrClient(target) && (newRole is null || IsStaffOrClient(newRole.Value)),
            _ => false
        };
    }

    /// <summary>
    /// Removing a member: anyone but the owner may leave; the owner removes
    /// anyone else; an admin removes staff and clients.
    /// </summary>
    public static bool CanRemoveMember(MembershipRole actor, bool isSelf, MembershipRole target)
    {
        if (isSelf)
        {
            return target != MembershipRole.Owner;
        }

        return actor switch
        {
            MembershipRole.Owner => true,
            MembershipRole.Admin => IsStaffOrClient(target),
            _ => false
        };
    }

    private static bool IsStaffOrClient(MembershipRole role) => role is MembershipRole.Staff or MembershipRole.Client;
}
