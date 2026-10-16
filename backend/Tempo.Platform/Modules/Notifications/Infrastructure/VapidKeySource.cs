using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;

namespace Tempo.Platform.Modules.Notifications.Infrastructure;

/// <summary>
/// Where the VAPID keys come from. Deployed: the SSM parameter names VAPID_PUBLIC_KEY_PARAMETER and
/// VAPID_PRIVATE_KEY_PARAMETER (names only; a person writes the values with tools/scripts/vapid-keys.mjs) and
/// VAPID_SUBJECT, the client app's origin. Locally and in tests: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as given.
/// No keys means no push: deliveries are skipped as `channel_unavailable` and the key route answers 404.
/// The private key is read only where <paramref name="needsPrivateKey"/> is set (the worker), never by the API.
/// </summary>
public sealed class VapidKeySource(Func<string, string?> setting, bool needsPrivateKey) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private VapidKeys? keys;
    private DateTimeOffset nextTry = DateTimeOffset.MinValue;

    public void Dispose() => gate.Dispose();

    public async Task<VapidKeys?> GetAsync(CancellationToken cancellationToken)
    {
        if (keys is not null || DateTimeOffset.UtcNow < nextTry)
        {
            return keys;
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            if (keys is null && DateTimeOffset.UtcNow >= nextTry)
            {
                keys = await ReadAsync(cancellationToken);
                // Not written yet: ask SSM again in ten minutes, not on every message.
                nextTry = DateTimeOffset.UtcNow.AddMinutes(10);
            }

            return keys;
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<VapidKeys?> ReadAsync(CancellationToken cancellationToken)
    {
        var subject = setting("VAPID_SUBJECT") is { Length: > 0 } s ? s : "https://localhost";
        if (setting("VAPID_PUBLIC_KEY") is { Length: > 0 } publicKey)
        {
            var privateKey = needsPrivateKey ? setting("VAPID_PRIVATE_KEY") : string.Empty;
            return privateKey is null ? null : new VapidKeys(publicKey, privateKey, subject);
        }

        if (setting("VAPID_PUBLIC_KEY_PARAMETER") is not { Length: > 0 } publicName)
        {
            return null;
        }

        using var ssm = new AmazonSimpleSystemsManagementClient();
        try
        {
            var publicValue = (await ssm.GetParameterAsync(new GetParameterRequest { Name = publicName }, cancellationToken)).Parameter.Value;
            if (!needsPrivateKey)
            {
                return new VapidKeys(publicValue, string.Empty, subject);
            }

            if (setting("VAPID_PRIVATE_KEY_PARAMETER") is not { Length: > 0 } privateName)
            {
                return null;
            }

            var privateValue = (await ssm.GetParameterAsync(new GetParameterRequest { Name = privateName, WithDecryption = true }, cancellationToken)).Parameter.Value;
            return new VapidKeys(publicValue, privateValue, subject);
        }
        catch (ParameterNotFoundException)
        {
            return null;
        }
    }
}
