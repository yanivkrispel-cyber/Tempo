using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>docs/40 PI-1 at the API: the pass import needs `people.import`, which staff and clients don't hold.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class PassImportEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();

    private readonly IPassImportService imports = Substitute.For<IPassImportService>();
    private readonly TestApi api;

    public PassImportEndpointTests()
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

        var response = await PostAsync(new { dryRun = true, rows = new[] { new { line = 2, email = "noa@example.com", product = "Card", entriesLeft = "3", validUntil = "31/12/2026" } } });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        imports.ReceivedCalls().Should().BeEmpty();
    }

    [Fact]
    public async Task AnOwner_ReachesTheService_WithTheRowsAsSent_AndGetsEveryField()
    {
        GivenMembership(SystemRoles.Owner);
        var person = Guid.CreateVersion7();
        imports.ImportAsync(Arg.Any<TenantContext>(), true, Arg.Any<IReadOnlyList<PassImportRowInput>>(), Arg.Any<CancellationToken>())
            .Returns(new PassImportResult(true, null, new ImportTotals(1, 0, 0, 0, 0, 1), [new PassImportRowOutcome(2, "invalid", person, Field: "entries_left", Code: "entries_left.too_many")]));

        var response = await PostAsync(new { dryRun = true, rows = new[] { new { line = 2, email = "noa@example.com", product = " Card ", entriesLeft = "30", validUntil = "31/12/2026" } } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("\"outcome\":\"invalid\"").And.Contain("\"field\":\"entries_left\"").And.Contain("\"code\":\"entries_left.too_many\"").And.Contain($"\"personId\":\"{person}\"");
        await imports.Received(1).ImportAsync(
            Arg.Any<TenantContext>(), true, Arg.Is<IReadOnlyList<PassImportRowInput>>(rows => rows.Single().Product == " Card " && rows.Single().EntriesLeft == "30"), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task WithoutDryRun_Is400()
    {
        GivenMembership(SystemRoles.Owner);

        var response = await PostAsync(new { rows = new[] { new { line = 2, email = "noa@example.com" } } });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        imports.ReceivedCalls().Should().BeEmpty();
    }

    private async Task<HttpResponseMessage> PostAsync(object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/organizations/{StudioId}/passes/import") { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }

    private void GivenMembership(SystemRole role) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), role.Role, MembershipStatus.Active, OrganizationStatus.Active, role.Permissions));
}
