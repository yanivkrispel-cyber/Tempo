using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Tempo.Contracts.Api.Organizations;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// HTTP translation of invitations and the join link (docs/26 sections 5 and
/// 8): links built from the app origins, tokens only in bodies, 410 and 429.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class InvitationEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid MembershipId = Guid.CreateVersion7();

    private readonly TestApi api = new();

    public InvitationEndpointTests()
    {
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, true));
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(MembershipId, MembershipRole.Owner, MembershipStatus.Active, OrganizationStatus.Active));
    }

    public void Dispose() => api.Dispose();

    [Theory]
    [InlineData("client", "http://localhost:5174/invite#tok")]
    [InlineData("staff", "http://localhost:5173/invite#tok")]
    public async Task Create_Returns201WithTheLinkForTheRightApp(string role, string link)
    {
        var parsed = Enum.Parse<MembershipRole>(role, ignoreCase: true);
        api.Invitations.CreateAsync(Arg.Any<TenantContext>(), "a@example.com", parsed, Arg.Any<CancellationToken>())
            .Returns(new CreatedInvitation(
                new InvitationView(Guid.CreateVersion7(), "a@example.com", parsed, InvitationStatus.Pending, DateTimeOffset.UtcNow.AddDays(7), DateTimeOffset.UtcNow, MembershipId, "Owner"),
                "tok"));

        var response = await SendAsync(HttpMethod.Post, $"/api/v1/organizations/{StudioId}/invitations", new CreateInvitationRequest("a@example.com", role));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<CreatedInvitationResponse>();
        created!.Link.Should().Be(link);
        created.Status.Should().Be("pending");
        created.InvitedBy.DisplayName.Should().Be("Owner");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("teacher")]
    public async Task Create_WithoutAKnownRole_Returns400(string? role)
    {
        // "owner" is a known role and is refused by RolePolicy in the service.
        var response = await SendAsync(HttpMethod.Post, $"/api/v1/organizations/{StudioId}/invitations", new CreateInvitationRequest("a@example.com", role));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Accept_SendsTheTokenFromTheBody_AndReturnsTheMembership()
    {
        api.Invitations.AcceptAsync(Arg.Any<AccountSnapshot>(), "the-token-from-the-body", Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new AccountMembership(MembershipId, MembershipRole.Staff, MembershipStatus.Active, StudioId, "studio-x", "X", OrganizationStatus.Active));

        var response = await SendAsync(HttpMethod.Post, "/api/v1/invitations/accept", new TokenRequest("the-token-from-the-body"));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("role").GetString().Should().Be("staff");
        body.RootElement.GetProperty("organization").GetProperty("slug").GetString().Should().Be("studio-x");
    }

    [Fact]
    public async Task Accept_Expired_Returns410()
    {
        api.Invitations.AcceptAsync(Arg.Any<AccountSnapshot>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new DomainRuleViolationException(ViolationKind.Gone, "invitation.expired", "Expired."));

        var response = await SendAsync(HttpMethod.Post, "/api/v1/invitations/accept", new TokenRequest("x"));

        response.StatusCode.Should().Be(HttpStatusCode.Gone);
    }

    [Fact]
    public async Task Join_OverTheLimit_Returns429WithRetryAfter()
    {
        api.JoinLinks.PreviewAsync(Arg.Any<AccountSnapshot>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new DomainRuleViolationException(ViolationKind.TooManyRequests, "rate_limited", "Later.") { RetryAfter = TimeSpan.FromSeconds(90.2) });

        var response = await SendAsync(HttpMethod.Post, "/api/v1/join/preview", new JoinCodeRequest("code"));

        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter!.Delta.Should().Be(TimeSpan.FromSeconds(91));
    }

    [Theory]
    [InlineData("client", "http://localhost:5174/s/neshima/invite#tok")]
    [InlineData("staff", "http://localhost:5173/invite#tok")]
    public async Task Create_SendsAClientToTheStudiosOwnApp(string role, string link)
    {
        // docs/35 W-4 (#404, K-WL5): a client's invitation opens the studio's own app at /s/<slug>/.
        var parsed = Enum.Parse<MembershipRole>(role, ignoreCase: true);
        api.Organizations.SlugAsync(Arg.Any<TenantContext>(), Arg.Any<CancellationToken>()).Returns("neshima");
        api.Invitations.CreateAsync(Arg.Any<TenantContext>(), "a@example.com", parsed, Arg.Any<CancellationToken>())
            .Returns(new CreatedInvitation(
                new InvitationView(Guid.CreateVersion7(), "a@example.com", parsed, InvitationStatus.Pending, DateTimeOffset.UtcNow.AddDays(7), DateTimeOffset.UtcNow, MembershipId, "Owner"),
                "tok"));

        var response = await SendAsync(HttpMethod.Post, $"/api/v1/organizations/{StudioId}/invitations", new CreateInvitationRequest("a@example.com", role));

        (await response.Content.ReadFromJsonAsync<CreatedInvitationResponse>())!.Link.Should().Be(link);
    }

    [Fact]
    public async Task RotateJoinLink_OpensTheStudiosOwnApp()
    {
        api.Organizations.SlugAsync(Arg.Any<TenantContext>(), Arg.Any<CancellationToken>()).Returns("neshima");
        api.JoinLinks.RotateAsync(Arg.Any<TenantContext>(), Arg.Any<CancellationToken>()).Returns("new-code");

        var response = await SendAsync(HttpMethod.Put, $"/api/v1/organizations/{StudioId}/join-link", body: null);

        (await response.Content.ReadFromJsonAsync<JoinLinkResponse>())!.Link.Should().Be("http://localhost:5174/s/neshima/join#new-code");
    }

    [Fact]
    public async Task RotateJoinLink_ReturnsTheClientAppLink()
    {
        api.JoinLinks.RotateAsync(Arg.Any<TenantContext>(), Arg.Any<CancellationToken>()).Returns("new-code");

        var response = await SendAsync(HttpMethod.Put, $"/api/v1/organizations/{StudioId}/join-link", body: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<JoinLinkResponse>())!.Link.Should().Be("http://localhost:5174/join#new-code");
    }

    [Fact]
    public async Task ListInvitations_ParsesTheComputedExpiredStatus()
    {
        api.Invitations.ListAsync(Arg.Any<TenantContext>(), Arg.Any<InvitationQuery>(), Arg.Any<CancellationToken>())
            .Returns(new InvitationPage([], null));

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/invitations?status=expired", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await api.Invitations.Received(1).ListAsync(Arg.Any<TenantContext>(), new InvitationQuery(InvitationStatus.Expired, null, 50), Arg.Any<CancellationToken>());
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }
}
