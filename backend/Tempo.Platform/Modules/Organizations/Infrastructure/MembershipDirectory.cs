using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Organizations.Infrastructure;

/// <summary>
/// Reads with the caller's account set and no tenant, so row-level security
/// shows only the caller's own memberships and the studios they belong to.
/// </summary>
public sealed class MembershipDirectory(IDataSourceProvider dataSources) : IMembershipDirectory
{
    public async Task<MembershipSnapshot?> FindAsync(Guid userAccountId, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userAccountId, null, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            SELECT m.id, m.role, m.status, o.status
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
            StoredValue.Parse<OrganizationStatus>(reader.GetString(3)));
    }

    public async Task<IReadOnlyList<AccountMembership>> ListForAccountAsync(Guid userAccountId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userAccountId, null, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            SELECT m.id, m.role, m.status, o.id, o.slug, o.display_name, o.status
            FROM organizations.memberships m
            JOIN organizations.organizations o ON o.id = m.organization_id
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
                StoredValue.Parse<OrganizationStatus>(reader.GetString(6))));
        }

        return memberships;
    }
}
