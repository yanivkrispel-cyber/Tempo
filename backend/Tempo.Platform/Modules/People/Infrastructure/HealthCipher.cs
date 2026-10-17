using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Tempo.Platform.Modules.People.Infrastructure;

/// <summary>
/// AES-256-GCM for one health declaration field (docs/31 section 7). The stored value is
/// `[0x01][nonce 12][ciphertext][tag 16]`. The associated data binds it to the studio, the declaration, the column
/// and the key version, so a ciphertext copied into another row, column or studio does not open. Any failure
/// throws `health.key_unavailable` (fail closed); the message never carries the value.
/// </summary>
public static class HealthCipher
{
    private const byte Format = 0x01;
    private const int NonceBytes = 12;
    private const int TagBytes = 16;

    public static byte[] Encrypt(byte[] key, string plaintext, HealthField field)
    {
        var data = Encoding.UTF8.GetBytes(plaintext);
        var result = new byte[1 + NonceBytes + data.Length + TagBytes];
        result[0] = Format;
        var nonce = result.AsSpan(1, NonceBytes);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(key, TagBytes);
        aes.Encrypt(nonce, data, result.AsSpan(1 + NonceBytes, data.Length), result.AsSpan(1 + NonceBytes + data.Length, TagBytes), field.AssociatedData());
        return result;
    }

    public static string Decrypt(byte[] key, byte[] stored, HealthField field)
    {
        if (stored.Length < 1 + NonceBytes + TagBytes || stored[0] != Format)
        {
            throw HealthDataKeys.Unavailable();
        }

        var length = stored.Length - 1 - NonceBytes - TagBytes;
        var data = new byte[length];
        try
        {
            using var aes = new AesGcm(key, TagBytes);
            aes.Decrypt(stored.AsSpan(1, NonceBytes), stored.AsSpan(1 + NonceBytes, length), stored.AsSpan(1 + NonceBytes + length, TagBytes), data, field.AssociatedData());
        }
        catch (CryptographicException)
        {
            throw HealthDataKeys.Unavailable();
        }

        return Encoding.UTF8.GetString(data);
    }
}

/// <summary>Where a ciphertext belongs: its studio, its declaration, its column, and the key version it used.</summary>
public sealed record HealthField(Guid OrganizationId, Guid DeclarationId, string Column, int KeyVersion)
{
    public byte[] AssociatedData() =>
        Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"tempo.health.v1|{OrganizationId:D}|{DeclarationId:D}|{Column}|{KeyVersion}"));
}
