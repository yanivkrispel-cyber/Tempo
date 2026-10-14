using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Identity.Infrastructure;

/// <summary>
/// Counts invitation and join attempts in identity.join_attempts. The attempt
/// commits in its own transaction before the work it guards, so a failed
/// attempt still counts.
/// </summary>
public sealed class AttemptLimiter(IDataSourceProvider dataSources) : IAttemptLimiter
{
    public const int PerHour = 20;

    public async Task CheckAsync(Guid userAccountId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, userAccountId, null, cancellationToken);

        await using (var prune = unitOfWork.Command(
            "DELETE FROM identity.join_attempts WHERE user_account_id = $1 AND attempted_at < now() - interval '1 day'",
            userAccountId))
        {
            await prune.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var record = unitOfWork.Command("INSERT INTO identity.join_attempts (user_account_id, attempted_at) VALUES ($1, now())", userAccountId))
        {
            await record.ExecuteNonQueryAsync(cancellationToken);
        }

        long count;
        DateTimeOffset oldest;
        await using (var window = unitOfWork.Command(
            "SELECT count(*), min(attempted_at) FROM identity.join_attempts WHERE user_account_id = $1 AND attempted_at > now() - interval '1 hour'",
            userAccountId))
        {
            await using var reader = await window.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            count = reader.GetInt64(0);
            oldest = await reader.GetFieldValueAsync<DateTimeOffset>(1, cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);

        if (count > PerHour)
        {
            var retryAfter = oldest.AddHours(1) - DateTimeOffset.UtcNow;
            throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "rate_limited", "Too many attempts. Try again later.")
            {
                RetryAfter = retryAfter > TimeSpan.Zero ? retryAfter : TimeSpan.FromSeconds(1)
            };
        }
    }
}
