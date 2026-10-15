using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using NSubstitute;
using Tempo.Contracts.Api.Authorization;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// The roles API (docs/27 section 6): the system roles, the catalog, and a
/// member's role set with step-up when it grants admin. The member service is a
/// substitute; its rank rules are tested against the database.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class RoleEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid MembershipId = Guid.CreateVersion7();
    private static readonly Guid Target = Guid.CreateVersion7();

    private readonly TestApi api = new();

    public RoleEndpointTests()
    {
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, true));
        api.Members.UpdateAsync(Arg.Any<TenantContext>(), Target, Arg.Any<MembershipRole?>(), null, Arg.Any<long?>(), Arg.Any<CancellationToken>())
            .Returns(call => new MemberView(Target, Guid.CreateVersion7(), "m@example.com", null, call.ArgAt<MembershipRole?>(2)!.Value, MembershipStatus.Active, DateTimeOffset.UtcNow, 3));
    }

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task ListRoles_GivesStaffTheFourSystemRolesWithTheirPermissions()
    {
        GivenMember(MembershipRole.Staff);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/roles", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<RoleListResponse>();
        body!.Items.Select(r => r.Key).Should().Equal("owner", "admin", "staff", "client");
        body.Items.Should().OnlyContain(r => r.IsSystem);
        body.Items.Single(r => r.Key == "client").Permissions.Should().Equal(Permissions.OrganizationView, Permissions.ScheduleView);
    }

    [Fact]
    public async Task ListPermissions_IsForOwnersOnly()
    {
        GivenMember(MembershipRole.Admin);
        var asAdmin = await api.GetAsync($"/api/v1/organizations/{StudioId}/permissions", api.CustomerToken());

        GivenMember(MembershipRole.Owner);
        var asOwner = await api.GetAsync($"/api/v1/organizations/{StudioId}/permissions", api.CustomerToken());

        asAdmin.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        asOwner.StatusCode.Should().Be(HttpStatusCode.OK);
        (await asOwner.Content.ReadFromJsonAsync<PermissionListResponse>())!.Items.Should().HaveCount(Permissions.Catalog.Count);
    }

    [Fact]
    public async Task SetRoles_ToStaff_ChangesTheRoleThroughTheMemberService()
    {
        GivenMember(MembershipRole.Admin);

        var response = await PutRolesAsync([SystemRoles.Staff.Id], authTime: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("roles")[0].GetProperty("key").GetString().Should().Be("staff");
        await api.Members.Received(1).UpdateAsync(Arg.Any<TenantContext>(), Target, MembershipRole.Staff, null, null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SetRoles_ToAdmin_NeedsASignInWithinTenMinutes()
    {
        GivenMember(MembershipRole.Owner);

        var stale = await PutRolesAsync([SystemRoles.Admin.Id], authTime: DateTimeOffset.UtcNow.AddMinutes(-11));
        var fresh = await PutRolesAsync([SystemRoles.Admin.Id], authTime: DateTimeOffset.UtcNow.AddMinutes(-2));

        stale.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await CodeOf(stale)).Should().Be("auth.step_up_required");
        fresh.StatusCode.Should().Be(HttpStatusCode.OK);
        await api.Members.Received(1).UpdateAsync(Arg.Any<TenantContext>(), Target, MembershipRole.Admin, null, null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SetRoles_ToAdmin_ByAnAdmin_IsRefusedBeforeAnySignInIsAsked()
    {
        GivenMember(MembershipRole.Admin);

        var response = await PutRolesAsync([SystemRoles.Admin.Id], authTime: DateTimeOffset.UtcNow.AddHours(-1));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("membership.forbidden_role_change");
        await api.Members.DidNotReceive().UpdateAsync(Arg.Any<TenantContext>(), Arg.Any<Guid>(), Arg.Any<MembershipRole?>(), Arg.Any<MembershipStatus?>(), Arg.Any<long?>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0, "role_ids.required")]
    [InlineData(2, "role_ids.single")]
    public async Task SetRoles_TakesExactlyOneRole(int count, string code)
    {
        GivenMember(MembershipRole.Owner);

        var response = await PutRolesAsync([.. new[] { SystemRoles.Staff.Id, SystemRoles.Client.Id }.Take(count)], authTime: null);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await CodeOf(response)).Should().Be(code);
    }

    [Fact]
    public async Task SetRoles_WithAnUnknownRole_Returns400()
    {
        GivenMember(MembershipRole.Owner);

        var response = await PutRolesAsync([Guid.CreateVersion7()], authTime: null);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await CodeOf(response)).Should().Be("role.not_found");
    }

    [Fact]
    public async Task SetRoles_IsRefusedWithoutMembersManage()
    {
        GivenMember(MembershipRole.Staff);

        var response = await PutRolesAsync([SystemRoles.Client.Id], authTime: null);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await CodeOf(response)).Should().Be("permission.denied");
    }

    private void GivenMember(MembershipRole role) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(MembershipId, role, MembershipStatus.Active, OrganizationStatus.Active));

    private async Task<HttpResponseMessage> PutRolesAsync(Guid[] roleIds, DateTimeOffset? authTime)
    {
        Claim[] claims = authTime is { } at ? [new Claim("auth_time", at.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture))] : [];
        var token = api.Token(TestApi.CustomerIssuer, TestApi.CustomerClient, extraClaims: claims);
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/organizations/{StudioId}/members/{Target}/roles")
        {
            Content = JsonContent.Create(new SetMemberRolesRequest(roleIds))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await api.CreateClient().SendAsync(request);
    }

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }
}
