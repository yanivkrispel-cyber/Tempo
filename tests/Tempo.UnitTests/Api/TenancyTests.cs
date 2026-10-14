using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using NSubstitute;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// The building blocks of docs/26 sections 2.2, 6 and 8.5: two token schemes,
/// the tenant route filter and Problem Details with a stable code, exercised
/// through probe endpoints mapped on the real route groups.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class TenancyTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid MembershipId = Guid.CreateVersion7();

    private readonly TestApi api = new(endpoints =>
    {
        var tenant = endpoints.MapTenantGroup();
        tenant.MapGet("/probe", (HttpContext http) => TenantRouteFilter.Current(http));
        tenant.MapGet("/settings-probe", () => "settings").WithMetadata(new AllowWhenOrganizationSuspendedAttribute());

        endpoints.MapPlatformGroup().MapGet("/probe", () => "operator");

        endpoints.MapAccountGroup().MapGet("/conflict-probe", string () =>
            throw new DomainRuleViolationException(ViolationKind.Conflict, "organization.slug_taken", "That address is taken."));
    });

    private static string TenantProbe => $"/api/v1/organizations/{StudioId}/probe";

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task PlatformRoute_WithOperatorToken_Returns200()
    {
        var response = await api.GetAsync("/api/v1/platform/probe", api.OperatorToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task PlatformRoute_WithCustomerToken_Returns401WithCode()
    {
        var response = await api.GetAsync("/api/v1/platform/probe", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await CodeOf(response)).Should().Be("auth.unauthorized");
    }

    [Theory]
    [InlineData("/api/v1/me")]
    [InlineData("/api/v1/conflict-probe")]
    public async Task CustomerRoute_WithOperatorToken_Returns401(string path)
    {
        var response = await api.GetAsync(path, api.OperatorToken());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task TenantRoute_WithOperatorToken_Returns401()
    {
        var response = await api.GetAsync(TenantProbe, api.OperatorToken());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task TenantRoute_BeforeTheFirstSession_Returns404NotProvisioned()
    {
        var response = await api.GetAsync(TenantProbe, api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await CodeOf(response)).Should().Be("account.not_provisioned");
    }

    [Fact]
    public async Task TenantRoute_WithDisabledAccount_Returns403()
    {
        GivenAccount(AccountStatus.Disabled);

        var response = await api.GetAsync(TenantProbe, api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("account.disabled");
    }

    [Fact]
    public async Task TenantRoute_WithoutMembership_Returns404LikeAMissingStudio()
    {
        GivenAccount(AccountStatus.Active);

        var response = await api.GetAsync(TenantProbe, api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await CodeOf(response)).Should().Be("organization.not_found");
    }

    [Theory]
    [InlineData(MembershipStatus.Removed, HttpStatusCode.NotFound, "organization.not_found")]
    [InlineData(MembershipStatus.Invited, HttpStatusCode.NotFound, "organization.not_found")]
    [InlineData(MembershipStatus.Suspended, HttpStatusCode.Forbidden, "membership.suspended")]
    public async Task TenantRoute_WithInactiveMembership_IsRefused(MembershipStatus status, HttpStatusCode expected, string code)
    {
        GivenAccount(AccountStatus.Active);
        GivenMembership(MembershipRole.Staff, status, OrganizationStatus.Active);

        var response = await api.GetAsync(TenantProbe, api.CustomerToken());

        response.StatusCode.Should().Be(expected);
        (await CodeOf(response)).Should().Be(code);
    }

    [Fact]
    public async Task TenantRoute_OfSuspendedStudio_Returns403UnlessTheRouteAllowsIt()
    {
        GivenAccount(AccountStatus.Active);
        GivenMembership(MembershipRole.Owner, MembershipStatus.Active, OrganizationStatus.Suspended);

        var refused = await api.GetAsync(TenantProbe, api.CustomerToken());
        var allowed = await api.GetAsync($"/api/v1/organizations/{StudioId}/settings-probe", api.CustomerToken());

        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(refused)).Should().Be("organization.suspended");
        allowed.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task TenantRoute_WithActiveMembership_GetsTheTenantContext()
    {
        GivenAccount(AccountStatus.Active);
        GivenMembership(MembershipRole.Admin, MembershipStatus.Active, OrganizationStatus.Active);

        var response = await api.GetAsync(TenantProbe, api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("organizationId").GetGuid().Should().Be(StudioId);
        body.RootElement.GetProperty("userAccountId").GetGuid().Should().Be(AccountId);
        body.RootElement.GetProperty("membershipId").GetGuid().Should().Be(MembershipId);
        body.RootElement.GetProperty("role").GetInt32().Should().Be((int)MembershipRole.Admin);
        await api.Accounts.Received(1).FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task TenantRoute_WithNonGuidId_Returns404()
    {
        var response = await api.GetAsync("/api/v1/organizations/not-a-guid/probe", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DomainRuleViolation_BecomesProblemDetailsWithItsCode()
    {
        var response = await api.GetAsync("/api/v1/conflict-probe", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("code").GetString().Should().Be("organization.slug_taken");
        body.RootElement.GetProperty("title").GetString().Should().Be("That address is taken.");
        body.RootElement.GetProperty("correlationId").GetString().Should().NotBeNullOrEmpty();
    }

    private void GivenAccount(AccountStatus status) =>
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, status, EmailVerified: true));

    private void GivenMembership(MembershipRole role, MembershipStatus status, OrganizationStatus organizationStatus) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(MembershipId, role, status, organizationStatus));

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }
}
