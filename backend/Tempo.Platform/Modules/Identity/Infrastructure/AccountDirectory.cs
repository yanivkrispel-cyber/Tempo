using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Identity.Infrastructure;

public sealed class AccountDirectory(IDataSourceProvider dataSources) : IAccountDirectory
{
    public async Task<AccountSnapshot?> FindByExternalIdentityAsync(string issuer, string subject, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            SELECT a.id, a.status, a.email_verified
            FROM identity.external_identities e
            JOIN identity.user_accounts a ON a.id = e.user_account_id
            WHERE e.issuer = $1 AND e.subject = $2
            """,
            issuer,
            subject);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AccountSnapshot(reader.GetGuid(0), StoredValue.Parse<AccountStatus>(reader.GetString(1)), reader.GetBoolean(2));
    }
}
