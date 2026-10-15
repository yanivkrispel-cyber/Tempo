using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>A-5 (docs/27 section 3.6): with TEMPO_REQUIRE_OWNER_MFA on, owners and admins need MFA on tenant routes.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class OwnerMfaTests
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();

    [Theory]
    [InlineData(true, MembershipRole.Owner, false, HttpStatusCode.Forbidden)]
    [InlineData(true, MembershipRole.Admin, false, HttpStatusCode.Forbidden)]
    [InlineData(true, MembershipRole.Owner, true, HttpStatusCode.OK)]
    [InlineData(true, MembershipRole.Staff, false, HttpStatusCode.OK)]
    [InlineData(false, MembershipRole.Owner, false, HttpStatusCode.OK)]
    public async Task OwnersAndAdmins_NeedMfa_OnlyWhenTheSwitchIsOn(bool required, MembershipRole role, bool mfa, HttpStatusCode expected)
    {
        using var api = new TestApi(
            endpoints => endpoints.MapTenantGroup().MapGet("/mfa-probe", () => "ok").RequirePermission(Permissions.OrganizationView),
            services => services.AddSingleton(new OwnerMfaPolicy(required)));
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, true, mfa));
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), role, MembershipStatus.Active, OrganizationStatus.Active));

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/mfa-probe", api.CustomerToken());

        response.StatusCode.Should().Be(expected);
        if (expected == HttpStatusCode.Forbidden)
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            body.RootElement.GetProperty("code").GetString().Should().Be("auth.mfa_required");
        }
    }
}
