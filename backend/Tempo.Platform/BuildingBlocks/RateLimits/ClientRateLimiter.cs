using System.Security.Cryptography;
using System.Text;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.BuildingBlocks.RateLimits;

/// <summary>
/// The per-client limits of board #404 S-A, as numbers in configuration (`RateLimits:<name>`), each per hour. The
/// gateway's route throttle protects the API as a whole; these keep one address or one account from using it all.
/// </summary>
public sealed record ClientRateLimits(int JoinPerIpPerHour, int JoinPerUserPerHour, int LinksPerUserPerHour)
{
    public static readonly ClientRateLimits Defaults = new(JoinPerIpPerHour: 10, JoinPerUserPerHour: 3, LinksPerUserPerHour: 30);

    /// <summary>Reads `RateLimits:JoinPerIpPerHour` and the others; a missing or invalid number keeps its default.</summary>
    public static ClientRateLimits From(Func<string, string?> setting) => new(
        Read(setting, nameof(JoinPerIpPerHour), Defaults.JoinPerIpPerHour),
        Read(setting, nameof(JoinPerUserPerHour), Defaults.JoinPerUserPerHour),
        Read(setting, nameof(LinksPerUserPerHour), Defaults.LinksPerUserPerHour));

    private static int Read(Func<string, string?> setting, string name, int fallback) =>
        int.TryParse(setting($"RateLimits:{name}"), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var value) && value > 0
            ? value
            : fallback;
}

/// <summary>Counts one request of a client in a bucket and refuses it with 429 once the window's limit is passed.</summary>
public interface IClientRateLimiter
{
    /// <summary>
    /// Counts this request for <paramref name="client"/> (an address or an account id, hashed before it is stored) in
    /// <paramref name="bucket"/>, and throws 429 `rate_limited` with `Retry-After` when the hour's count is over
    /// <paramref name="perHour"/>. The count commits on its own, before the work it guards, so refused requests count too.
    /// </summary>
    Task HitAsync(string bucket, string client, int perHour, CancellationToken cancellationToken);
}

public sealed class ClientRateLimiter(IDataSourceProvider dataSources, TimeProvider clock) : IClientRateLimiter
{
    private static readonly TimeSpan Window = TimeSpan.FromHours(1);

    public async Task HitAsync(string bucket, string client, int perHour, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var start = new DateTimeOffset(now.UtcTicks - (now.UtcTicks % Window.Ticks), TimeSpan.Zero);
        var key = SHA256.HashData(Encoding.UTF8.GetBytes($"{bucket}|{client}"));

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        int hits;
        await using (var count = unitOfWork.Command(
            """
            INSERT INTO identity.rate_counters (bucket, client_key, window_start, hits) VALUES ($1, $2, $3, 1)
            ON CONFLICT (bucket, client_key, window_start) DO UPDATE SET hits = identity.rate_counters.hits + 1
            RETURNING hits
            """,
            bucket, key, start))
        {
            hits = (int)(await count.ExecuteScalarAsync(cancellationToken))!;
        }

        // The first request of a client in a window clears that client's older windows; a day keeps the table small.
        if (hits == 1)
        {
            await using var prune = unitOfWork.Command("DELETE FROM identity.rate_counters WHERE window_start < $1", start.AddDays(-1));
            await prune.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);

        if (hits > perHour)
        {
            var retryAfter = start + Window - now;
            throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "rate_limited", "Too many requests. Try again later.")
            {
                RetryAfter = retryAfter > TimeSpan.Zero ? retryAfter : TimeSpan.FromSeconds(1)
            };
        }
    }
}
