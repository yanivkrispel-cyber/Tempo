using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>docs/34 section 3 at the API: the import needs `people.import`, which staff and clients don't hold.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class PeopleImportEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();

    private readonly IPeopleImportService imports = Substitute.For<IPeopleImportService>();
    private readonly TestApi api;

    public PeopleImportEndpointTests()
    {
        api = new TestApi(configure: services => services.AddSingleton(imports));
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, EmailVerified: true));
    }

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task Staff_Get403_AndTheServiceIsNeverAsked()
    {
        GivenMembership(SystemRoles.Staff);

        var response = await PostAsync(new { dryRun = true, rows = new[] { new { line = 2, displayName = "Noa", email = "noa@example.com" } } });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        imports.ReceivedCalls().Should().BeEmpty();
    }

    [Fact]
    public async Task AnAdmin_ReachesTheService_WithTheRowsAsSent()
    {
        GivenMembership(SystemRoles.Admin);
        imports.ImportAsync(Arg.Any<TenantContext>(), true, Arg.Any<IReadOnlyList<ImportRowInput>>(), Arg.Any<CancellationToken>(), null)
            .Returns(new ImportResult(true, null, new ImportTotals(1, 1, 0, 0, 0, 0), [new ImportRowOutcome(2, "valid")]));

        var response = await PostAsync(new { dryRun = true, rows = new[] { new { line = 2, displayName = " Noa ", email = "noa@example.com" } } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Contain("\"outcome\":\"valid\"");
        await imports.Received(1).ImportAsync(
            Arg.Any<TenantContext>(), true, Arg.Is<IReadOnlyList<ImportRowInput>>(rows => rows.Single().DisplayName == " Noa "), Arg.Any<CancellationToken>(), null);
    }

    [Fact]
    public async Task ABatchTag_IsPassedToTheService()
    {
        GivenMembership(SystemRoles.Admin);
        var tag = Guid.CreateVersion7();
        imports.ImportAsync(Arg.Any<TenantContext>(), true, Arg.Any<IReadOnlyList<ImportRowInput>>(), Arg.Any<CancellationToken>(), tag)
            .Returns(new ImportResult(true, null, new ImportTotals(1, 1, 0, 0, 0, 0), [new ImportRowOutcome(2, "valid")]));

        var response = await PostAsync(new { dryRun = true, tagId = tag, rows = new[] { new { line = 2, displayName = "Noa", email = "noa@example.com" } } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await imports.Received(1).ImportAsync(Arg.Any<TenantContext>(), true, Arg.Any<IReadOnlyList<ImportRowInput>>(), Arg.Any<CancellationToken>(), tag);
    }

    private async Task<HttpResponseMessage> PostAsync(object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/organizations/{StudioId}/people/import") { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }

    private void GivenMembership(SystemRole role) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), role.Role, MembershipStatus.Active, OrganizationStatus.Active, role.Permissions));
}
