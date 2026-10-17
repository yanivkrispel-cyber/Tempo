using System.Collections.Concurrent;
using System.Globalization;
using Amazon.Runtime;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Platform.Modules.People.Infrastructure;

/// <summary>
/// The health data keys (docs/31 section 7, ADR-0026): 32 random bytes per version. Deployed: an SSM SecureString
/// per version under HEALTH_DATA_KEY_PARAMETER_PREFIX (a person writes it with tools/scripts/health-data-key.mjs),
/// read once and kept in memory. Locally and in tests: HEALTH_DATA_KEY_V{n} as base64. Writes use
/// HEALTH_DATA_KEY_CURRENT_VERSION (default 1). A key that cannot be read fails closed with 503
/// `health.key_unavailable`; nothing falls back to another version. The key is never logged.
/// </summary>
public interface IHealthDataKeys
{
    int CurrentVersion { get; }

    Task<byte[]> GetAsync(int version, CancellationToken cancellationToken);
}

/// <param name="readParameter">Reads one SSM SecureString by name; tests replace it. Defaults to the SSM client.</param>
public sealed class HealthDataKeys(Func<string, string?> setting, Func<string, CancellationToken, Task<string>>? readParameter = null) : IHealthDataKeys, IDisposable
{
    public const int KeyBytes = 32;

    private readonly ConcurrentDictionary<int, byte[]> keys = new();
    private readonly SemaphoreSlim gate = new(1, 1);

    public int CurrentVersion =>
        int.TryParse(setting("HEALTH_DATA_KEY_CURRENT_VERSION"), NumberStyles.None, CultureInfo.InvariantCulture, out var version) && version >= 1 ? version : 1;

    public void Dispose() => gate.Dispose();

    public async Task<byte[]> GetAsync(int version, CancellationToken cancellationToken)
    {
        if (keys.TryGetValue(version, out var cached))
        {
            return cached;
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            if (keys.TryGetValue(version, out cached))
            {
                return cached;
            }

            var key = Decode(await ReadAsync(version, cancellationToken));
            keys[version] = key;
            return key;
        }
        finally
        {
            gate.Release();
        }
    }

    public static DomainRuleViolationException Unavailable() =>
        new(ViolationKind.ServiceUnavailable, "health.key_unavailable", "Health declarations cannot be opened right now.");

    private async Task<string?> ReadAsync(int version, CancellationToken cancellationToken)
    {
        var name = string.Create(CultureInfo.InvariantCulture, $"HEALTH_DATA_KEY_V{version}");
        if (setting(name) is { Length: > 0 } local)
        {
            return local;
        }

        if (setting("HEALTH_DATA_KEY_PARAMETER_PREFIX") is not { Length: > 0 } prefix)
        {
            return null;
        }

        try
        {
            return await (readParameter ?? ReadSsmAsync)(string.Create(CultureInfo.InvariantCulture, $"{prefix}{version}"), cancellationToken);
        }
        catch (Exception exception) when (exception is AmazonServiceException or AmazonClientException or HttpRequestException)
        {
            // Not written yet, no permission, no credentials or no network: the answers stay closed with 503, never
            // a 500 (#239 review). The exception's text is not logged here; it can carry the parameter name only.
            return null;
        }
    }

    private static async Task<string> ReadSsmAsync(string name, CancellationToken cancellationToken)
    {
        using var ssm = new AmazonSimpleSystemsManagementClient();
        return (await ssm.GetParameterAsync(new GetParameterRequest { Name = name, WithDecryption = true }, cancellationToken)).Parameter.Value;
    }

    private static byte[] Decode(string? value)
    {
        if (value is null)
        {
            throw Unavailable();
        }

        try
        {
            var key = Convert.FromBase64String(value);
            return key.Length == KeyBytes ? key : throw Unavailable();
        }
        catch (FormatException)
        {
            throw Unavailable();
        }
    }
}
