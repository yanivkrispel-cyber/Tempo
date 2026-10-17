using System.Security.Cryptography;
using System.Text;
using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.Modules.People.Infrastructure;
using Xunit;

namespace Tempo.UnitTests.People;

/// <summary>docs/31 section 7: AES-256-GCM per field, bound to its row, column, studio and key version; fails closed.</summary>
public sealed class HealthCipherTests
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);
    private static readonly HealthField Field = new(Guid.CreateVersion7(), Guid.CreateVersion7(), "signed_name_ciphertext", 1);

    // A generic name; no real person's data, not even in tests.
    private const string Plaintext = "ישראלה ישראלי";

    [Fact]
    public void RoundTrip_ReturnsThePlaintext_AndTheStoredBytesDoNotHoldIt()
    {
        var stored = HealthCipher.Encrypt(Key, Plaintext, Field);

        HealthCipher.Decrypt(Key, stored, Field).Should().Be(Plaintext);
        Contains(stored, Encoding.UTF8.GetBytes(Plaintext)).Should().BeFalse();
        stored[0].Should().Be(0x01);
    }

    [Fact]
    public void EachEncryption_UsesAFreshNonce()
    {
        HealthCipher.Encrypt(Key, Plaintext, Field).Should().NotEqual(HealthCipher.Encrypt(Key, Plaintext, Field));
    }

    public static TheoryData<HealthField> OtherPlaces() => new()
    {
        Field with { DeclarationId = Guid.CreateVersion7() },
        Field with { OrganizationId = Guid.CreateVersion7() },
        Field with { Column = "guardian_name_ciphertext" },
        Field with { KeyVersion = 2 }
    };

    [Theory]
    [MemberData(nameof(OtherPlaces))]
    public void ACiphertextMovedToAnotherPlace_DoesNotOpen(HealthField elsewhere)
    {
        var stored = HealthCipher.Encrypt(Key, Plaintext, Field);

        var open = () => HealthCipher.Decrypt(Key, stored, elsewhere);

        open.Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("health.key_unavailable");
    }

    [Fact]
    public void TheWrongKey_FailsClosed()
    {
        var stored = HealthCipher.Encrypt(Key, Plaintext, Field);

        var open = () => HealthCipher.Decrypt(RandomNumberGenerator.GetBytes(32), stored, Field);

        var failure = open.Should().Throw<DomainRuleViolationException>().Which;
        failure.Code.Should().Be("health.key_unavailable");
        failure.Kind.Should().Be(ViolationKind.ServiceUnavailable);
        failure.Message.Should().NotContain(Plaintext);
    }

    [Fact]
    public void ATamperedOrTruncatedValue_FailsClosed()
    {
        var stored = HealthCipher.Encrypt(Key, Plaintext, Field);
        var tampered = (byte[])stored.Clone();
        tampered[^1] ^= 0xFF;

        ((Action)(() => HealthCipher.Decrypt(Key, tampered, Field))).Should().Throw<DomainRuleViolationException>();
        ((Action)(() => HealthCipher.Decrypt(Key, stored[..20], Field))).Should().Throw<DomainRuleViolationException>();
    }

    [Fact]
    public async Task Keys_ReadTheLocalSetting_AndFailClosedWithoutOne()
    {
        var encoded = Convert.ToBase64String(Key);
        using var keys = new HealthDataKeys(name => name == "HEALTH_DATA_KEY_V1" ? encoded : null);

        keys.CurrentVersion.Should().Be(1);
        (await keys.GetAsync(1, CancellationToken.None)).Should().Equal(Key);
        (await keys.Invoking(k => k.GetAsync(2, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>())
            .Which.Code.Should().Be("health.key_unavailable");
    }

    [Fact]
    public async Task Keys_RefuseAKeyThatIsNot32Bytes()
    {
        using var keys = new HealthDataKeys(name => name == "HEALTH_DATA_KEY_V1" ? Convert.ToBase64String(new byte[16]) : null);

        await keys.Invoking(k => k.GetAsync(1, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>();
    }

    private static bool Contains(byte[] haystack, byte[] needle) =>
        Enumerable.Range(0, haystack.Length - needle.Length + 1).Any(i => haystack.AsSpan(i, needle.Length).SequenceEqual(needle));
}
