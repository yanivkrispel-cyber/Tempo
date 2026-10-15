using System.Net;
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
/// Permission evaluation on tenant routes (docs/27 section 3.4): the route
/// names one permission, the tenant filter checks the caller's loaded set, and
/// a route without a declaration is refused.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class PermissionTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid MembershipId = Guid.CreateVersion7();

    private readonly TestApi api = new(endpoints =>
    {
        var tenant = endpoints.MapTenantGroup();
        tenant.MapGet("/members-probe", (HttpContext http) => TenantRouteFilter.Current(http).EffectivePermissions.Order())
            .RequirePermission(Permissions.MembersView);
        tenant.MapGet("/undeclared-probe", () => "open");
    });

    public PermissionTests() =>
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, EmailVerified: true));

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task MissingPermission_Returns403PermissionDenied()
    {
        GivenMembership(MembershipRole.Client, permissions: null);

        var response = await api.GetAsync(Probe("members-probe"), api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("permission.denied");
    }

    [Fact]
    public async Task LoadedPermissions_DecideNotTheRoleColumn()
    {
        GivenMembership(MembershipRole.Client, new HashSet<string> { Permissions.OrganizationView, Permissions.MembersView });

        var response = await api.GetAsync(Probe("members-probe"), api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var permissions = JsonSerializer.Deserialize<string[]>(await response.Content.ReadAsStringAsync());
        permissions.Should().Equal(Permissions.MembersView, Permissions.OrganizationView);
    }

    [Fact]
    public async Task AnOwnerWithNoLiveAssignment_IsDenied()
    {
        GivenMembership(MembershipRole.Owner, new HashSet<string>());

        var response = await api.GetAsync(Probe("members-probe"), api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ARouteWithoutADeclaredPermission_IsRefusedEvenForTheOwner()
    {
        GivenMembership(MembershipRole.Owner, permissions: null);

        var response = await api.GetAsync(Probe("undeclared-probe"), api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("permission.denied");
    }

    [Fact]
    public void EveryRealTenantRoute_DeclaresAPermissionFromTheCatalog()
    {
        using var real = new TestApi();
        var tenantPrefix = $"/api/v1/organizations/{{{TenantRouteFilter.RouteValue}:guid}}";
        var endpoints = real.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(e => ("/" + e.RoutePattern.RawText?.TrimStart('/')).StartsWith(tenantPrefix, StringComparison.Ordinal))
            .ToList();

        endpoints.Should().NotBeEmpty();
        foreach (var endpoint in endpoints)
        {
            var declared = endpoint.Metadata.GetMetadata<RequirePermissionAttribute>();
            declared.Should().NotBeNull($"{endpoint.DisplayName} is a tenant route");
            Permissions.Catalog.Should().ContainKey(declared!.Permission);
        }
    }

    [Fact]
    public void SystemRoles_MatchThePhaseOneMatrix()
    {
        SystemRoles.Owner.Permissions.Should().HaveCount(15);
        string[] ownerOnly = [Permissions.RolesManage, Permissions.MembersInviteAdmin, Permissions.PeopleErase, Permissions.OwnershipTransfer];
        string[] staff = [Permissions.OrganizationView, Permissions.MembersView, Permissions.PeopleView, Permissions.PeopleManage];
        SystemRoles.Admin.Permissions.Should().HaveCount(11).And.NotContain(ownerOnly);
        SystemRoles.Staff.Permissions.Should().BeEquivalentTo(staff);
        SystemRoles.Client.Permissions.Should().ContainSingle().Which.Should().Be(Permissions.OrganizationView);
    }

    private static string Probe(string name) => $"/api/v1/organizations/{StudioId}/{name}";

    private void GivenMembership(MembershipRole role, IReadOnlySet<string>? permissions) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(MembershipId, role, MembershipStatus.Active, OrganizationStatus.Active, permissions));

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }
}
