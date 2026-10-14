using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Tempo.Api.DependencyInjection;
using Tempo.Contracts.Api.Account;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// POST /api/v1/session, GET /api/v1/me and PATCH /api/v1/me (docs/26
/// section 8.1), with the API's own Cognito access-token validation
/// (ADR-0004 amendment) in front of them.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class AccountEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly AccountView Account = new(AccountId, "dana@example.com", true, "Dana", "he-IL", AccountStatus.Active);

    private readonly TestApi api = new();

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task Me_WithoutToken_Returns401()
    {
        var response = await api.GetAsync("/api/v1/me", token: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Me_WithAccessTokenInTempoHeader_ReturnsOk()
    {
        // Behind CloudFront OAC the Authorization header carries CloudFront's
        // SigV4 signature, so the client sends the token in X-Tempo-Authorization.
        GivenAccount();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        request.Headers.Add(CognitoAuthentication.TokenHeader, "Bearer " + api.CustomerToken());
        request.Headers.Authorization = new AuthenticationHeaderValue("AWS4-HMAC-SHA256", "Credential=cloudfront-signature");

        var response = await api.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("id", TestApi.CustomerClient, 10, "an ID token is not an access token")]
    [InlineData("access", "other-client", 10, "the token was issued to another app client")]
    [InlineData("access", TestApi.CustomerClient, -10, "the token has expired")]
    public async Task Me_WithRejectedToken_Returns401(string tokenUse, string clientId, int expiresInMinutes, string because)
    {
        var token = api.Token(TestApi.CustomerIssuer, clientId, tokenUse: tokenUse, expiresInMinutes: expiresInMinutes);

        var response = await api.GetAsync("/api/v1/me", token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, because);
    }

    [Fact]
    public async Task Me_WithTokenFromAnotherIssuer_Returns401()
    {
        var token = api.Token("https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_OtherPool", TestApi.CustomerClient);

        var response = await api.GetAsync("/api/v1/me", token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Me_BeforeTheFirstSession_Returns404NotProvisioned()
    {
        var response = await api.GetAsync("/api/v1/me", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await CodeOf(response)).Should().Be("account.not_provisioned");
    }

    [Fact]
    public async Task Me_ReturnsTheAccountAndItsStudiosInContractShape()
    {
        GivenAccount();
        api.Memberships.ListForAccountAsync(AccountId, Arg.Any<CancellationToken>()).Returns(
        [
            new AccountMembership(Guid.CreateVersion7(), MembershipRole.Owner, MembershipStatus.Active, StudioId, "studio-neshima", "נשימה", OrganizationStatus.Suspended)
        ]);

        var response = await api.GetAsync("/api/v1/me", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        root.GetProperty("id").GetGuid().Should().Be(AccountId);
        root.GetProperty("email").GetString().Should().Be("dana@example.com");
        root.GetProperty("status").GetString().Should().Be("active");
        var membership = root.GetProperty("memberships")[0];
        membership.GetProperty("role").GetString().Should().Be("owner");
        membership.GetProperty("organization").GetProperty("status").GetString().Should().Be("suspended");
        membership.GetProperty("organization").GetProperty("displayName").GetString().Should().Be("נשימה");
    }

    [Fact]
    public async Task Session_PassesTheSignInFromTheToken()
    {
        var authTime = DateTimeOffset.UtcNow.AddMinutes(-2);
        api.AccountService.StartSessionAsync(Arg.Any<SignIn>(), Arg.Any<CancellationToken>()).Returns(Account);
        var token = api.Token(
            TestApi.CustomerIssuer,
            TestApi.CustomerClient,
            "sub-1",
            "access",
            10,
            new Claim("username", "cognito-user-1"),
            new Claim("auth_time", authTime.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture), ClaimValueTypes.Integer64));

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/session");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<MeResponse>())!.Id.Should().Be(AccountId);
        await api.AccountService.Received(1).StartSessionAsync(
            Arg.Is<SignIn>(s =>
                s.Issuer == TestApi.CustomerIssuer
                && s.Subject == "sub-1"
                && s.Username == "cognito-user-1"
                && s.AuthTime == DateTimeOffset.FromUnixTimeSeconds(authTime.ToUnixTimeSeconds())),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Session_ForADisabledAccount_Returns403()
    {
        api.AccountService.StartSessionAsync(Arg.Any<SignIn>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new DomainRuleViolationException(ViolationKind.Forbidden, "account.disabled", "This account is disabled."));

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/session");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        var response = await api.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("account.disabled");
    }

    [Fact]
    public async Task UpdateMe_ForADisabledAccount_Returns403()
    {
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Disabled, true));

        var response = await PatchMeAsync(new UpdateMeRequest("New name", null));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("account.disabled");
    }

    [Fact]
    public async Task UpdateMe_WithAnInvalidField_Returns400ListingTheField()
    {
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, true));
        api.AccountService.UpdateAsync(AccountId, null, "fr-FR", Arg.Any<CancellationToken>())
            .ThrowsAsync(new DomainRuleViolationException(ViolationKind.Validation, "locale.unsupported", "Unsupported language.", "locale"));

        var response = await PatchMeAsync(new UpdateMeRequest(null, "fr-FR"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("code").GetString().Should().Be("locale.unsupported");
        body.RootElement.GetProperty("errors")[0].GetProperty("field").GetString().Should().Be("locale");
    }

    [Fact]
    public async Task UpdateMe_ReturnsTheUpdatedAccount()
    {
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, true));
        api.AccountService.UpdateAsync(AccountId, "Dana B", null, Arg.Any<CancellationToken>())
            .Returns(Account with { DisplayName = "Dana B" });

        var response = await PatchMeAsync(new UpdateMeRequest("Dana B", null));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<MeResponse>())!.DisplayName.Should().Be("Dana B");
    }

    private void GivenAccount() =>
        api.AccountService.FindAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>()).Returns(Account);

    private async Task<HttpResponseMessage> PatchMeAsync(UpdateMeRequest body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, "/api/v1/me") { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }
}
