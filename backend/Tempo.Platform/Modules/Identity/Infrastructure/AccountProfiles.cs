using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Identity.Infrastructure;

/// <summary>
/// Names and emails for other modules (member lists), so they never read the
/// identity tables themselves (docs/26 section 11).
/// </summary>
public sealed class AccountProfiles(IDataSourceProvider dataSources) : IAccountProfiles
{
    public async Task<IReadOnlyDictionary<Guid, AccountProfile>> FindAsync(IReadOnlyCollection<Guid> userAccountIds, CancellationToken cancellationToken)
    {
        if (userAccountIds.Count == 0)
        {
            return new Dictionary<Guid, AccountProfile>();
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        await using var command = unitOfWork.Command(
            "SELECT id, email, display_name FROM identity.user_accounts WHERE id = ANY($1)",
            userAccountIds.ToArray());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var profiles = new Dictionary<Guid, AccountProfile>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var id = reader.GetGuid(0);
            profiles[id] = new AccountProfile(id, reader.GetString(1), await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetString(2));
        }

        return profiles;
    }
}
