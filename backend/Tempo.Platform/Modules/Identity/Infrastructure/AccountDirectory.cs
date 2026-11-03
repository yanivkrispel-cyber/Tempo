using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Identity.Infrastructure;

public sealed class AccountDirectory(IDataSourceProvider dataSources) : IAccountDirectory
{
    public async Task<AccountSnapshot?> FindByExternalIdentityAsync(string issuer, string subject, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        // Every request starts here, before the account id is known: row-level security would hide the row, so
        // the SECURITY DEFINER lookup returns the one account linked to this sign-in (migration 0040).
        await using var command = unitOfWork.Command(
            "SELECT id, status, email_verified, mfa_enabled FROM identity.find_account_by_external_identity($1, $2)",
            issuer,
            subject);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AccountSnapshot(reader.GetGuid(0), StoredValue.Parse<AccountStatus>(reader.GetString(1)), reader.GetBoolean(2), reader.GetBoolean(3));
    }
}
