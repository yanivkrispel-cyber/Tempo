using System.Net;
using System.Net.Http.Headers;
using Amazon.SimpleSystemsManagement;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Support;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>Board #584, PL-4: the console's help contact, for any signed-in account, hidden when none is set.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class SupportContactEndpointTests
{
    [Fact]
    public async Task ASetContact_IsReturnedWithItsKind()
    {
        using var api = Api(name => name == "SUPPORT_CONTACT" ? " help@example.com " : null);

        var response = await GetAsync(api);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("{\"contact\":\"help@example.com\",\"kind\":\"email\"}");
    }

    [Fact]
    public async Task NoContact_IsNulls_SoTheConsoleHidesIt()
    {
        using var api = Api(_ => null);

        var response = await GetAsync(api);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Be("{\"contact\":null,\"kind\":null}");
    }

    [Fact]
    public async Task WithoutAToken_Is401()
    {
        using var api = Api(_ => null);

        var response = await api.CreateClient().GetAsync("/api/v1/support-contact");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task TheParameter_IsReadByItsName_AndNotAgainWithinTenMinutes()
    {
        var reads = 0;
        using var source = new SupportContactSource(
            name => name == "SUPPORT_CONTACT_PARAMETER" ? "/tempo/dev/support/contact" : null,
            (name, _) =>
            {
                reads++;
                return Task.FromResult<string?>(name == "/tempo/dev/support/contact" ? "https://example.com/whatsapp" : null);
            });

        var first = await source.GetAsync(CancellationToken.None);
        var second = await source.GetAsync(CancellationToken.None);

        first.Should().Be(new SupportContact("https://example.com/whatsapp", "url"));
        second.Should().Be(first);
        reads.Should().Be(1);
    }

    [Fact]
    public async Task AFailedRead_KeepsTheLastValue_AndTriesAgainAfterAMinute()
    {
        var clock = new ManualClock();
        var reads = 0;
        using var source = new SupportContactSource(
            name => name == "SUPPORT_CONTACT_PARAMETER" ? "/tempo/dev/support/contact" : null,
            (_, _) => ++reads == 2
                ? throw new AmazonSimpleSystemsManagementException("Rate exceeded")
                : Task.FromResult<string?>("help@example.com"),
            clock);

        var first = await source.GetAsync(CancellationToken.None);
        clock.Now += TimeSpan.FromMinutes(11);
        var failed = await source.GetAsync(CancellationToken.None);
        clock.Now += TimeSpan.FromSeconds(30);
        var waiting = await source.GetAsync(CancellationToken.None);
        clock.Now += TimeSpan.FromSeconds(31);
        var again = await source.GetAsync(CancellationToken.None);

        first.Should().Be(new SupportContact("help@example.com", "email"));
        failed.Should().Be(first);
        waiting.Should().Be(first);
        again.Should().Be(first);
        reads.Should().Be(3, "the failed read is retried after a minute, not on every request");
    }

    [Fact]
    public async Task AFailedFirstRead_MeansNoContact_NotAnError()
    {
        using var source = new SupportContactSource(
            name => name == "SUPPORT_CONTACT_PARAMETER" ? "/tempo/dev/support/contact" : null,
            (_, _) => throw new AmazonSimpleSystemsManagementException("AccessDenied"));

        (await source.GetAsync(CancellationToken.None)).Should().BeNull();
    }

    [Theory]
    [InlineData("help@example.com", "help@example.com", "email")]
    [InlineData("https://example.com/help", "https://example.com/help", "url")]
    [InlineData("http://example.com/help", null, null)]
    [InlineData("javascript:alert(1)", null, null)]
    [InlineData("https://user:pass@example.com/", null, null)]
    [InlineData("Help <help@example.com>", null, null)]
    [InlineData("not a contact", null, null)]
    [InlineData("", null, null)]
    public void OnlyAnEmailOrAnHttpsLink_IsAContact(string value, string? contact, string? kind)
    {
        var parsed = SupportContact.Parse(value);

        parsed?.Contact.Should().Be(contact);
        parsed?.Kind.Should().Be(kind);
        (parsed is null).Should().Be(contact is null);
    }

    private static TestApi Api(Func<string, string?> setting)
    {
        var api = new TestApi(configure: services => services.AddSingleton(new SupportContactSource(setting)));
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(Guid.CreateVersion7(), AccountStatus.Active, EmailVerified: true));
        return api;
    }

    private sealed class ManualClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 3, 10, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static async Task<HttpResponseMessage> GetAsync(TestApi api)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/support-contact");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }
}
