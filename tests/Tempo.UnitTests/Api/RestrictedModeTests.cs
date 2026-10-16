using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// Restricted mode in the tenant filter (docs/28 section 4, B-8): a restricted studio reads, and only the
/// allowlisted writes (cancel a booking, export, billing details) still work.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class RestrictedModeTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();

    private readonly TestApi api = new(endpoints =>
    {
        var tenant = endpoints.MapTenantGroup();
        tenant.MapGet("/read-probe", () => "read").RequirePermission(Permissions.OrganizationView);
        tenant.MapPost("/write-probe", () => "written").RequirePermission(Permissions.OrganizationView);
        tenant.MapPost("/allowed-probe", () => "allowed").RequirePermission(Permissions.OrganizationView)
            .WithMetadata(new AllowWhenSubscriptionRestrictedAttribute());
    });

    public RestrictedModeTests() =>
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, EmailVerified: true));

    public void Dispose() => api.Dispose();

    [Theory]
    [InlineData("active", "write-probe", HttpStatusCode.OK)]
    [InlineData("restricted", "write-probe", HttpStatusCode.PaymentRequired)]
    [InlineData("restricted", "allowed-probe", HttpStatusCode.OK)]
    [InlineData(null, "write-probe", HttpStatusCode.OK)]
    public async Task Writes_FollowTheSubscriptionState(string? state, string probe, HttpStatusCode expected)
    {
        GivenSubscription(state);

        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/organizations/{StudioId}/{probe}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        using var client = api.CreateClient();
        var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(expected);
        if (expected == HttpStatusCode.PaymentRequired)
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            body.RootElement.GetProperty("code").GetString().Should().Be("billing.restricted");
        }
    }

    [Fact]
    public async Task Reads_StayOpen_WhenRestricted()
    {
        GivenSubscription("restricted");

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/read-probe", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public void TheAllowlist_IsExactlyDocs28Section4()
    {
        using var host = new TestApi();
        var allowed = host.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .Where(endpoint => endpoint.Metadata.GetMetadata<AllowWhenSubscriptionRestrictedAttribute>() is not null)
            .Select(endpoint => endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName)
            .Order(StringComparer.Ordinal);

        allowed.Should().Equal(
            "acceptOwnershipTransfer", "cancelBooking", "cancelOwnershipTransfer", "declineOwnershipTransfer", "disableJoinLink",
            "erasePerson", "exportPerson", "recordMyConsent", "removeMember", "revokeInvitation", "startOwnershipTransfer",
            "updateBillingAccount");
    }

    private void GivenSubscription(string? state) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), MembershipRole.Owner, MembershipStatus.Active, OrganizationStatus.Active, null, state));
}
