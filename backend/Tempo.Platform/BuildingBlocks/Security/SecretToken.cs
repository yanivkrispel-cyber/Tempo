using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace Tempo.Platform.BuildingBlocks.Security;

/// <summary>
/// Random tokens for invitation links and join codes (docs/26 section 5).
/// Only the SHA-256 hash is stored; the token itself is shown once.
/// </summary>
public static class SecretToken
{
    /// <summary>A new base64url token of <paramref name="bytes"/> random bytes, and its hash.</summary>
    public static (string Token, byte[] Hash) New(int bytes)
    {
        var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));
        return (token, Hash(token));
    }

    public static byte[] Hash(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));
}
