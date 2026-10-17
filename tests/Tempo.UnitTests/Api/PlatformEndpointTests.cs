using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using NSubstitute;
using Tempo.Contracts.Api.Platform;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.PlatformAdmin;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>The operator console routes (docs/26 section 8.4) and a studio's audit log.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class PlatformEndpointTests : IDisposable
{
    private static readonly Guid OperatorId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();

    private static readonly PlatformOrganizationView Studio = new(
        StudioId, "studio-x", "X", OrganizationStatus.Active, DateTimeOffset.UtcNow, Guid.CreateVersion7(), "owner@example.com", null, new MemberCounts(1, 0, 2, 7));

    private readonly TestApi api = new();

    public PlatformEndpointTests()
    {
        api.Operators.FindActiveAsync(TestApi.OperatorIssuer, "operator-1", Arg.Any<CancellationToken>()).Returns((OperatorId, "kris@example.com"));
    }

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task List_ParsesStatusAndReturnsCounts()
    {
        api.Platform.ListAsync(OrganizationStatus.Suspended, null, 50, Arg.Any<CancellationToken>()).Returns(new PlatformOrganizationPage([Studio], null));

        var response = await api.GetAsync("/api/v1/platform/organizations?status=suspended", api.OperatorToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await response.Content.ReadFromJsonAsync<PlatformOrganizationPageResponse>();
        page!.Items.Should().ContainSingle().Which.MemberCounts.Client.Should().Be(7);
    }

    [Fact]
    public async Task Suspend_PassesTheOperatorAndTheReason()
    {
        api.Platform.SetStatusAsync(Arg.Any<OperatorContext>(), StudioId, OrganizationStatus.Suspended, "unpaid for months", Arg.Any<CancellationToken>())
            .Returns(Studio with { Status = OrganizationStatus.Suspended });

        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/platform/organizations/{StudioId}/suspend")
        {
            Content = JsonContent.Create(new ReasonRequest("unpaid for months"))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.OperatorToken());
        var response = await api.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<PlatformOrganizationResponse>())!.Status.Should().Be("suspended");
        await api.Platform.Received(1).SetStatusAsync(
            Arg.Is<OperatorContext>(o => o.OperatorId == OperatorId),
            StudioId,
            OrganizationStatus.Suspended,
            "unpaid for months",
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Stats_ReturnsTheBackupThreshold()
    {
        api.Platform.StatsAsync(Arg.Any<CancellationToken>()).Returns(new PlatformStats(3, 1, 20, 30, PlatformService.HourlyBackupThreshold));

        var response = await api.GetAsync("/api/v1/platform/stats", api.OperatorToken());

        (await response.Content.ReadFromJsonAsync<PlatformStatsResponse>())!.HourlyBackupThreshold.Should().Be(10);
    }

    [Fact]
    public async Task DeletingAStudio_WithoutARecentSignIn_Is401_AndNothingIsDeleted()
    {
        var response = await DeleteStudioAsync(DateTimeOffset.UtcNow.AddMinutes(-11));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await api.Platform.DidNotReceiveWithAnyArgs().DeleteOrganizationAsync(default!, Guid.Empty, default, default, default);
    }

    [Fact]
    public async Task DeletingAStudio_PassesTheTypedName_AndAnswers204()
    {
        var response = await DeleteStudioAsync(DateTimeOffset.UtcNow.AddMinutes(-1));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        await api.Platform.Received(1).DeleteOrganizationAsync(Arg.Is<OperatorContext>(o => o.OperatorId == OperatorId), StudioId, "e2e-x", Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("dev", null, 0)]
    [InlineData("prod", null, 30)]
    [InlineData("stg", null, 30)]
    [InlineData(null, null, 30)]
    [InlineData("prod", "45", 45)]
    [InlineData("dev", "not-a-number", 0)]
    public void StudioRemovalMinDays_IsZeroOnDevOnly_UnlessConfigured(string? environment, string? configured, int expected)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["TEMPO_ENVIRONMENT"] = environment, ["TEMPO_STUDIO_REMOVAL_MIN_DAYS"] = configured })
            .Build();

        Tempo.Api.Endpoints.PlatformEndpoints.StudioRemovalMinDays(configuration).Should().Be(expected);
    }

    private async Task<HttpResponseMessage> DeleteStudioAsync(DateTimeOffset authTime)
    {
        var token = api.Token(
            TestApi.OperatorIssuer,
            TestApi.OperatorClient,
            "operator-1",
            extraClaims: new Claim("auth_time", authTime.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64));
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/platform/organizations/{StudioId}") { Content = JsonContent.Create(new { confirmName = "e2e-x" }) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await api.CreateClient().SendAsync(request);
    }

    [Fact]
    public async Task CustomerToken_OnTheConsole_Returns401()
    {
        var response = await api.GetAsync("/api/v1/platform/stats", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AuditEvents_ReturnDataAsJson()
    {
        var accountId = Guid.CreateVersion7();
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(accountId, AccountStatus.Active, true));
        api.Memberships.FindAsync(accountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), MembershipRole.Owner, MembershipStatus.Active, OrganizationStatus.Active));
        using var data = JsonDocument.Parse("""{"before":"staff","after":"client"}""");
        api.Audit.ListAsync(Arg.Any<TenantContext>(), null, 50, Arg.Any<CancellationToken>()).Returns(new AuditEventPage(
            [new AuditEventView(Guid.CreateVersion7(), DateTimeOffset.UtcNow, "user", "Dana", "membership.role_changed", "membership", Guid.CreateVersion7(), data.RootElement.Clone())],
            null));

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/audit-events", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var item = body.RootElement.GetProperty("items")[0];
        item.GetProperty("actorDisplayName").GetString().Should().Be("Dana");
        item.GetProperty("data").GetProperty("after").GetString().Should().Be("client");
    }
}
