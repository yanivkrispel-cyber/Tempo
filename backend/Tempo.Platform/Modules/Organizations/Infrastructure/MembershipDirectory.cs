using System.Text.Json;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Organizations.Infrastructure;

/// <summary>
/// Reads with the caller's account set and no tenant, so row-level security
/// shows only the caller's own memberships, the studios they belong to and
/// their own role assignments (migration 0005). The permission union is loaded
/// in the same query as the membership (docs/27 section 3.4), so evaluation
/// costs no extra round trip.
/// </summary>
public sealed class MembershipDirectory(IDataSourceProvider dataSources) : IMembershipDirectory
{
    private const string PermissionsOf =
        """
        coalesce((
            SELECT array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key)
            FROM authz.role_assignments ra
            JOIN authz.role_permissions rp ON rp.role_id = ra.role_id
            WHERE ra.organization_id = m.organization_id AND ra.membership_id = m.id AND ra.status = 'active'
        ), '{}')
        """;

    private const string RolesOf =
        """
        coalesce((
            SELECT json_agg(json_build_object('id', r.id, 'key', r.key, 'displayName', r.display_name, 'isSystem', r.is_system) ORDER BY r.key)
            FROM authz.role_assignments ra
            JOIN authz.roles r ON r.id = ra.role_id
            WHERE ra.organization_id = m.organization_id AND ra.membership_id = m.id AND ra.status = 'active'
        ), '[]')::text
        """;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<MembershipSnapshot?> FindAsync(Guid userAccountId, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userAccountId, null, cancellationToken);
        await using var command = unitOfWork.Command(
            $"""
            SELECT m.id, m.role, m.status, o.status, {PermissionsOf},
                   (SELECT s.state FROM billing.subscriptions s WHERE s.organization_id = m.organization_id AND s.state <> 'canceled')
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

        return new MembershipSnapshot(
            reader.GetGuid(0),
            StoredValue.Parse<MembershipRole>(reader.GetString(1)),
            StoredValue.Parse<MembershipStatus>(reader.GetString(2)),
            StoredValue.Parse<OrganizationStatus>(reader.GetString(3)),
            (await reader.GetFieldValueAsync<string[]>(4, cancellationToken)).ToHashSet(StringComparer.Ordinal),
            await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5));
    }

    public async Task<IReadOnlyList<AccountMembership>> ListForAccountAsync(Guid userAccountId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userAccountId, null, cancellationToken);
        await using var command = unitOfWork.Command(
            $"""
            SELECT m.id, m.role, m.status, o.id, o.slug, o.display_name, o.status,
                   {RolesOf}, {PermissionsOf},
                   t.id, CASE WHEN t.from_membership_id = m.id THEN 'outgoing' ELSE 'incoming' END, t.expires_at,
                   (SELECT s.state FROM billing.subscriptions s WHERE s.organization_id = m.organization_id AND s.state <> 'canceled'),
                   ((SELECT coalesce(jsonb_object_agg(e.key, e.value), jsonb_build_object()) FROM billing.subscriptions s
                       JOIN billing.plan_entitlements e ON e.plan_version_id = s.plan_version_id
                       WHERE s.organization_id = m.organization_id AND s.state <> 'canceled')
                    || (SELECT coalesce(jsonb_object_agg(x.key, x.value), jsonb_build_object()) FROM billing.entitlement_overrides x
                       WHERE x.organization_id = m.organization_id AND (x.ends_at IS NULL OR x.ends_at > now())))::text,
                   o.time_zone
            FROM organizations.memberships m
            JOIN organizations.organizations o ON o.id = m.organization_id
            LEFT JOIN organizations.ownership_transfers t
                ON t.organization_id = m.organization_id AND t.status = 'pending' AND t.expires_at > now()
               AND m.id IN (t.from_membership_id, t.to_membership_id)
            WHERE m.user_account_id = $1 AND m.status <> 'removed'
            ORDER BY m.created_at, m.id
            """,
            userAccountId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var memberships = new List<AccountMembership>();
        while (await reader.ReadAsync(cancellationToken))
        {
            memberships.Add(new AccountMembership(
                reader.GetGuid(0),
                StoredValue.Parse<MembershipRole>(reader.GetString(1)),
                StoredValue.Parse<MembershipStatus>(reader.GetString(2)),
                reader.GetGuid(3),
                reader.GetString(4),
                reader.GetString(5),
                StoredValue.Parse<OrganizationStatus>(reader.GetString(6)),
                JsonSerializer.Deserialize<List<RoleSummary>>(reader.GetString(7), Json) ?? [],
                await reader.GetFieldValueAsync<string[]>(8, cancellationToken),
                await reader.IsDBNullAsync(9, cancellationToken)
                    ? null
                    : new PendingOwnershipTransfer(
                        reader.GetGuid(9),
                        reader.GetString(10),
                        await reader.GetFieldValueAsync<DateTimeOffset>(11, cancellationToken)),
                await reader.IsDBNullAsync(12, cancellationToken) ? null : reader.GetString(12),
                await reader.IsDBNullAsync(13, cancellationToken) ? null : reader.GetString(13),
                reader.GetString(14)));
        }

        return memberships;
    }
}
