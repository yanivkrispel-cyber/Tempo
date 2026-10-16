using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Tempo.Platform.Modules.Notifications.Infrastructure;

/// <summary>
/// The environment's VAPID key pair (RFC 8292), base64url without padding: the public key is the 65-byte
/// uncompressed P-256 point, the private key the 32-byte scalar. A person writes both to SSM (docs/30 section 4.3,
/// tools/scripts/vapid-keys.mjs); nothing in the repository holds a key.
/// </summary>
public sealed record VapidKeys(string PublicKey, string PrivateKey, string Subject);

/// <summary>How a push service answered (RFC 8030 section 5).</summary>
public enum PushOutcome
{
    /// <summary>201: the push service took the message.</summary>
    Accepted,

    /// <summary>404 or 410: the subscription is gone; delete it.</summary>
    Gone,

    /// <summary>429, 5xx or no answer: try again later.</summary>
    Retry,

    /// <summary>Any other answer (400, 403, 413): retrying will not help.</summary>
    Failed
}

public sealed record PushTarget(string Endpoint, string P256dh, string Auth);

/// <summary>
/// The browser push services a subscription may point at: Chrome and Edge (FCM), Firefox (Mozilla autopush),
/// Windows (WNS) and Safari (Apple). Anything else is refused at subscribe time and again before sending, so the
/// worker never posts to an address a client made up.
/// </summary>
public static class PushEndpoints
{
    private static readonly string[] Hosts = ["fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];

    public static bool IsAllowed(string endpoint) =>
        endpoint.Length <= 2048
        && Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.IsDefaultPort
        && string.IsNullOrEmpty(uri.UserInfo)
        && Hosts.Any(h => uri.Host.Equals(h, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + h, StringComparison.OrdinalIgnoreCase));
}

/// <summary>Sends one encrypted push message; the payload is ids and a kind, never a name or a message text.</summary>
public interface IPushSender
{
    Task<(PushOutcome Outcome, int? Status)> SendAsync(PushTarget target, ReadOnlyMemory<byte> payload, bool urgent, CancellationToken cancellationToken);
}

/// <summary>
/// Web push without a third-party service: the `aes128gcm` content encoding of RFC 8291 and a VAPID ES256 token
/// (RFC 8292) per push-service origin, built on .NET's own ECDH, AES-GCM and HMAC.
/// </summary>
public sealed class WebPushSender(HttpClient http, VapidKeys keys, TimeProvider clock) : IPushSender
{
    private const int TimeToLiveSeconds = 24 * 60 * 60;

    public async Task<(PushOutcome Outcome, int? Status)> SendAsync(PushTarget target, ReadOnlyMemory<byte> payload, bool urgent, CancellationToken cancellationToken)
    {
        if (!PushEndpoints.IsAllowed(target.Endpoint) || !Uri.TryCreate(target.Endpoint, UriKind.Absolute, out var endpoint))
        {
            return (PushOutcome.Failed, null);
        }

        byte[] body;
        try
        {
            body = WebPushCrypto.Encrypt(payload.Span, Base64Url.Decode(target.P256dh), Base64Url.Decode(target.Auth));
        }
        catch (Exception e) when (e is CryptographicException or FormatException or ArgumentException)
        {
            return (PushOutcome.Failed, null);
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation("TTL", TimeToLiveSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        request.Headers.TryAddWithoutValidation("Urgency", urgent ? "high" : "normal");
        var audience = endpoint.GetLeftPart(UriPartial.Authority);
        request.Headers.TryAddWithoutValidation("Authorization", $"vapid t={VapidToken.Create(audience, keys, clock.GetUtcNow())}, k={keys.PublicKey}");

        try
        {
            using var response = await http.SendAsync(request, cancellationToken);
            var status = (int)response.StatusCode;
            return (response.StatusCode switch
            {
                HttpStatusCode.Created or HttpStatusCode.OK or HttpStatusCode.Accepted => PushOutcome.Accepted,
                HttpStatusCode.NotFound or HttpStatusCode.Gone => PushOutcome.Gone,
                HttpStatusCode.TooManyRequests => PushOutcome.Retry,
                _ when status >= 500 => PushOutcome.Retry,
                _ => PushOutcome.Failed
            }, status);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return (PushOutcome.Retry, null);
        }
    }
}

/// <summary>The VAPID JWT (RFC 8292 section 2): ES256 over `aud`, `exp` (12 hours) and `sub`.</summary>
public static class VapidToken
{
    public static string Create(string audience, VapidKeys keys, DateTimeOffset now)
    {
        var header = Base64Url.Encode("""{"typ":"JWT","alg":"ES256"}"""u8);
        var claims = Base64Url.Encode(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
        {
            ["aud"] = audience,
            ["exp"] = now.AddHours(12).ToUnixTimeSeconds(),
            ["sub"] = keys.Subject
        }));
        var signingInput = Encoding.ASCII.GetBytes($"{header}.{claims}");
        using var key = ECDsa.Create(PrivateParameters(keys));
        var signature = key.SignData(signingInput, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"{header}.{claims}.{Base64Url.Encode(signature)}";
    }

    private static ECParameters PrivateParameters(VapidKeys keys)
    {
        var point = Base64Url.Decode(keys.PublicKey);
        if (point.Length != 65 || point[0] != 0x04)
        {
            throw new CryptographicException("The VAPID public key is not an uncompressed P-256 point.");
        }

        return new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = Base64Url.Decode(keys.PrivateKey),
            Q = new ECPoint { X = point[1..33], Y = point[33..] }
        };
    }
}

/// <summary>The `aes128gcm` encryption of a push message (RFC 8291 section 3, RFC 8188), one record.</summary>
public static class WebPushCrypto
{
    private const int RecordSize = 4096;

    public static byte[] Encrypt(ReadOnlySpan<byte> plaintext, byte[] userAgentPublic, byte[] authSecret, ECDiffieHellman? serverKey = null, byte[]? salt = null)
    {
        if (userAgentPublic.Length != 65 || userAgentPublic[0] != 0x04 || authSecret.Length != 16)
        {
            throw new CryptographicException("The subscription keys are not a P-256 point and a 16-byte secret.");
        }

        if (plaintext.Length > RecordSize - 16 - 1 - 86)
        {
            throw new ArgumentException("The payload is too large for one record.", nameof(plaintext));
        }

        using var ownKey = serverKey is null ? ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256) : null;
        var key = serverKey ?? ownKey!;
        salt ??= RandomNumberGenerator.GetBytes(16);

        using var peer = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = userAgentPublic[1..33], Y = userAgentPublic[33..] }
        });
        var sharedSecret = key.DeriveRawSecretAgreement(peer.PublicKey);
        var serverPublic = PublicPoint(key);

        // The input key mixes the shared secret with the browser's auth secret and both public keys (section 3.4).
        var keyInfo = Concat(Encoding.ASCII.GetBytes("WebPush: info\0"), userAgentPublic, serverPublic);
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, sharedSecret, 32, authSecret, keyInfo);
        var contentKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        // One record: the plaintext and the 0x02 delimiter of the last record (RFC 8188 section 2).
        var padded = new byte[plaintext.Length + 1];
        plaintext.CopyTo(padded);
        padded[^1] = 0x02;
        var cipher = new byte[padded.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(contentKey, 16))
        {
            aes.Encrypt(nonce, padded, cipher, tag);
        }

        var header = new byte[16 + 4 + 1 + serverPublic.Length];
        salt.CopyTo(header, 0);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(16, 4), RecordSize);
        header[20] = (byte)serverPublic.Length;
        serverPublic.CopyTo(header, 21);
        return Concat(header, cipher, tag);
    }

    public static byte[] PublicPoint(ECDiffieHellman key)
    {
        var q = key.ExportParameters(false).Q;
        return Concat([0x04], q.X!, q.Y!);
    }

    private static byte[] Concat(params byte[][] parts)
    {
        var result = new byte[parts.Sum(p => p.Length)];
        var offset = 0;
        foreach (var part in parts)
        {
            part.CopyTo(result, offset);
            offset += part.Length;
        }

        return result;
    }
}

public static class Base64Url
{
    public static string Encode(ReadOnlySpan<byte> bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] Decode(string value)
    {
        var s = value.Trim().Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + ((4 - (s.Length % 4)) % 4), '='));
    }
}
