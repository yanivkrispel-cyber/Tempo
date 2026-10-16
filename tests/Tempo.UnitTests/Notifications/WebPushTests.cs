using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Tempo.Platform.Modules.Notifications.Infrastructure;
using Xunit;

namespace Tempo.UnitTests.Notifications;

/// <summary>The push encryption against the worked example of RFC 8291 section 5, and the VAPID token of RFC 8292.</summary>
public sealed class WebPushTests
{
    // RFC 8291 section 5 (published test values, not keys of any real party).
    private const string Plaintext = "When I grow up, I want to be a watermelon";
    private const string ServerPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    private const string ServerPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private const string UserAgentPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    private const string UserAgentPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private const string AuthSecret = "BTBZMqHH6r4Tts7J_aSIgg";
    private const string Salt = "DGv6ra1nlYgDCS1FRnbzlw";
    private const string Expected = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    [Fact]
    public void Encrypt_MatchesTheRfcExample()
    {
        using var server = Key(ServerPrivate, ServerPublic);
        var body = WebPushCrypto.Encrypt(Encoding.UTF8.GetBytes(Plaintext), Base64Url.Decode(UserAgentPublic), Base64Url.Decode(AuthSecret), server, Base64Url.Decode(Salt));
        Base64Url.Encode(body).Should().Be(Expected);
    }

    [Fact]
    public void AFreshMessage_DecryptsWithTheBrowsersKey()
    {
        var payload = """{"kind":"booking.promoted"}"""u8.ToArray();
        var body = WebPushCrypto.Encrypt(payload, Base64Url.Decode(UserAgentPublic), Base64Url.Decode(AuthSecret));

        Decrypt(body).Should().Equal(payload);
        Base64Url.Encode(WebPushCrypto.Encrypt(payload, Base64Url.Decode(UserAgentPublic), Base64Url.Decode(AuthSecret))).Should().NotBe(Base64Url.Encode(body), "a new key and salt every time");
    }

    [Fact]
    public void BadSubscriptionKeys_AreRefused()
    {
        var bad = () => WebPushCrypto.Encrypt("x"u8, new byte[33], Base64Url.Decode(AuthSecret));
        bad.Should().Throw<CryptographicException>();
    }

    [Fact]
    public void TheVapidToken_IsSignedForThePushServiceOrigin()
    {
        using var vapid = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = vapid.ExportParameters(true);
        var keys = new VapidKeys(Base64Url.Encode([0x04, .. p.Q.X!, .. p.Q.Y!]), Base64Url.Encode(p.D), "https://tempo.example.com");
        var now = new DateTimeOffset(2026, 10, 16, 9, 0, 0, TimeSpan.Zero);

        var token = VapidToken.Create("https://push.example.net", keys, now).Split('.');

        var claims = JsonSerializer.Deserialize<JsonElement>(Base64Url.Decode(token[1]));
        claims.GetProperty("aud").GetString().Should().Be("https://push.example.net");
        claims.GetProperty("sub").GetString().Should().Be("https://tempo.example.com");
        claims.GetProperty("exp").GetInt64().Should().Be(now.AddHours(12).ToUnixTimeSeconds());
        vapid.VerifyData(Encoding.ASCII.GetBytes($"{token[0]}.{token[1]}"), Base64Url.Decode(token[2]), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation)
            .Should().BeTrue();
    }

    [Theory]
    [InlineData(HttpStatusCode.Created, PushOutcome.Accepted)]
    [InlineData(HttpStatusCode.Gone, PushOutcome.Gone)]
    [InlineData(HttpStatusCode.NotFound, PushOutcome.Gone)]
    [InlineData(HttpStatusCode.TooManyRequests, PushOutcome.Retry)]
    [InlineData(HttpStatusCode.ServiceUnavailable, PushOutcome.Retry)]
    [InlineData(HttpStatusCode.BadRequest, PushOutcome.Failed)]
    public async Task TheSender_PostsAnEncryptedMessage_AndReadsTheAnswer(HttpStatusCode answer, PushOutcome expected)
    {
        var handler = new Recorder(answer);
        var sender = new WebPushSender(new HttpClient(handler), Vapid(), TimeProvider.System);

        var (outcome, status) = await sender.SendAsync(new PushTarget("https://fcm.googleapis.com/fcm/send/abc", UserAgentPublic, AuthSecret), "{}"u8.ToArray(), urgent: true, CancellationToken.None);

        outcome.Should().Be(expected);
        status.Should().Be((int)answer);
        var request = handler.Requests.Single();
        request.Headers.GetValues("Authorization").Single().Should().StartWith("vapid t=").And.Contain(", k=");
        request.Headers.GetValues("TTL").Single().Should().Be("86400");
        request.Headers.GetValues("Urgency").Single().Should().Be("high");
        request.Content!.Headers.ContentEncoding.Should().Equal("aes128gcm");
    }

    [Theory]
    [InlineData("https://push.example.com/abc")]
    [InlineData("http://fcm.googleapis.com/fcm/send/abc")]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/abc")]
    [InlineData("https://fcm.googleapis.com.example.com/abc")]
    [InlineData("https://169.254.169.254/latest")]
    public async Task OnlyBrowserPushServices_AreCalled(string endpoint)
    {
        var handler = new Recorder(HttpStatusCode.Created);
        var sender = new WebPushSender(new HttpClient(handler), Vapid(), TimeProvider.System);

        (await sender.SendAsync(new PushTarget(endpoint, UserAgentPublic, AuthSecret), "{}"u8.ToArray(), urgent: false, CancellationToken.None)).Outcome.Should().Be(PushOutcome.Failed);
        handler.Requests.Should().BeEmpty();
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc")]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/abc")]
    [InlineData("https://wns2-db5p.notify.windows.com/w/?token=abc")]
    [InlineData("https://web.push.apple.com/abc")]
    public void TheFourBrowserPushServices_AreAllowed(string endpoint) => PushEndpoints.IsAllowed(endpoint).Should().BeTrue();

    private static VapidKeys Vapid()
    {
        using var vapid = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = vapid.ExportParameters(true);
        return new VapidKeys(Base64Url.Encode([0x04, .. p.Q.X!, .. p.Q.Y!]), Base64Url.Encode(p.D), "https://tempo.example.com");
    }

    private sealed class Recorder(HttpStatusCode answer) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(new HttpResponseMessage(answer));
        }
    }

    /// <summary>The receiving side of RFC 8291 section 3.4, as a browser does it.</summary>
    private static byte[] Decrypt(byte[] body)
    {
        var salt = body[..16];
        var keyLength = body[20];
        var serverPublic = body[21..(21 + keyLength)];
        var cipher = body[(21 + keyLength)..];

        using var browser = Key(UserAgentPrivate, UserAgentPublic);
        using var server = ECDiffieHellman.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = serverPublic[1..33], Y = serverPublic[33..] } });
        var shared = browser.DeriveRawSecretAgreement(server.PublicKey);
        var info = Encoding.ASCII.GetBytes("WebPush: info\0").Concat(Base64Url.Decode(UserAgentPublic)).Concat(serverPublic).ToArray();
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, Base64Url.Decode(AuthSecret), info);
        var key = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));
        var plain = new byte[cipher.Length - 16];
        using (var aes = new AesGcm(key, 16))
        {
            aes.Decrypt(nonce, cipher[..^16], cipher[^16..], plain);
        }

        plain[^1].Should().Be(0x02, "the last record's delimiter");
        return plain[..^1];
    }

    private static ECDiffieHellman Key(string privateKey, string publicKey)
    {
        var point = Base64Url.Decode(publicKey);
        return ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = Base64Url.Decode(privateKey),
            Q = new ECPoint { X = point[1..33], Y = point[33..] }
        });
    }
}
