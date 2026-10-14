using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using NSubstitute;
using Tempo.Contracts.Api.Organizations;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// HTTP translation of the studio and member routes (docs/26 sections 3.2 and
/// 8.2). The services are substitutes; their rules are tested against the
/// database in Tempo.IntegrationTests.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class OrganizationEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid MembershipId = Guid.CreateVersion7();

    private static readonly OrganizationView Studio = new(
        StudioId, "studio-neshima", "נשימה", OrganizationStatus.Suspended, "IL", "he-IL", "Asia/Jerusalem", "ILS", false, DateTimeOffset.UtcNow, 7);

    private readonly TestApi api = new();

    public OrganizationEndpointTests()
    {
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, true));
    }

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task Create_Returns201WithLocationAndContractShape()
    {
        api.Organizations.CreateAsync(Arg.Any<AccountSnapshot>(), Arg.Any<NewOrganization>(), Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(Studio);

        var response = await SendAsync(HttpMethod.Post, "/api/v1/organizations", new CreateOrganizationRequest("נשימה", "studio-neshima", null, null));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location!.ToString().Should().Be($"/api/v1/organizations/{StudioId}");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("status").GetString().Should().Be("suspended");
        body.RootElement.GetProperty("version").GetString().Should().Be("7");
        await api.Organizations.Received(1).CreateAsync(
            Arg.Is<AccountSnapshot>(a => a.UserAccountId == AccountId),
            new NewOrganization("נשימה", "studio-neshima", null, null),
            Arg.Any<string>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Get_AnswersForASuspendedStudio()
    {
        GivenMember(MembershipRole.Client, OrganizationStatus.Suspended);
        api.Organizations.GetAsync(Arg.Any<TenantContext>(), Arg.Any<CancellationToken>()).Returns(Studio);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<OrganizationResponse>())!.Slug.Should().Be("studio-neshima");
    }

    [Theory]
    [InlineData("\"7\"", 7L)]
    [InlineData("W/\"7\"", 7L)]
    [InlineData("7", 7L)]
    [InlineData(null, null)]
    public async Task Update_PassesIfMatchAsTheExpectedVersion(string? ifMatch, long? expected)
    {
        GivenMember(MembershipRole.Owner, OrganizationStatus.Active);
        api.Organizations.UpdateAsync(Arg.Any<TenantContext>(), Arg.Any<OrganizationChanges>(), Arg.Any<long?>(), Arg.Any<CancellationToken>())
            .Returns(Studio with { Version = 8 });

        var response = await SendAsync(HttpMethod.Patch, $"/api/v1/organizations/{StudioId}", new UpdateOrganizationRequest("New", null, null), ifMatch);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await api.Organizations.Received(1).UpdateAsync(
            Arg.Is<TenantContext>(t => t.OrganizationId == StudioId && t.Role == MembershipRole.Owner),
            new OrganizationChanges("New", null, null),
            expected,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ListMembers_ParsesFiltersAndPage()
    {
        GivenMember(MembershipRole.Staff, OrganizationStatus.Active);
        var before = Guid.CreateVersion7();
        api.Members.ListAsync(Arg.Any<TenantContext>(), Arg.Any<MemberQuery>(), Arg.Any<CancellationToken>())
            .Returns(new MemberPage([new MemberView(MembershipId, AccountId, "a@example.com", null, MembershipRole.Client, MembershipStatus.Active, DateTimeOffset.UtcNow, 1)], before));

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/members?role=client&status=active&before={before}&limit=10", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await response.Content.ReadFromJsonAsync<MemberPageResponse>();
        page!.Items.Should().ContainSingle().Which.Role.Should().Be("client");
        page.NextBefore.Should().Be(before);
        await api.Members.Received(1).ListAsync(
            Arg.Any<TenantContext>(),
            new MemberQuery(MembershipRole.Client, MembershipStatus.Active, before, 10),
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("role=Owner")]
    [InlineData("role=1")]
    [InlineData("status=gone")]
    public async Task ListMembers_RejectsUnknownFilterValues(string query)
    {
        GivenMember(MembershipRole.Owner, OrganizationStatus.Active);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/members?{query}", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task RemoveMember_Returns204()
    {
        GivenMember(MembershipRole.Admin, OrganizationStatus.Active);
        var target = Guid.CreateVersion7();

        var response = await SendAsync(HttpMethod.Delete, $"/api/v1/organizations/{StudioId}/members/{target}", body: null);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        await api.Members.Received(1).RemoveAsync(Arg.Is<TenantContext>(t => t.Role == MembershipRole.Admin), target, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MemberRoutes_AreRefusedForASuspendedStudio()
    {
        GivenMember(MembershipRole.Owner, OrganizationStatus.Suspended);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/members", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    private void GivenMember(MembershipRole role, OrganizationStatus organizationStatus) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(MembershipId, role, MembershipStatus.Active, organizationStatus));

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body, string? ifMatch = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }
}
