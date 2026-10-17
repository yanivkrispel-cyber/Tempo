using System.Net;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>docs/32 section 3 at the API: the report routes need `reports.view`, which staff and clients don't hold.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class ReportEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();

    private readonly IReportService reports = Substitute.For<IReportService>();
    private readonly TestApi api;

    public ReportEndpointTests()
    {
        api = new TestApi(configure: services => services.AddSingleton(reports));
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, EmailVerified: true));
    }

    public void Dispose() => api.Dispose();

    [Theory]
    [InlineData("summary")]
    [InlineData("passes-ending")]
    [InlineData("members-at-risk")]
    public async Task Staff_Get403_AndTheServiceIsNeverAsked(string report)
    {
        GivenMembership(SystemRoles.Staff);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/reports/{report}", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        reports.ReceivedCalls().Should().BeEmpty();
    }

    [Fact]
    public async Task ABadDate_Is400PeriodInvalid()
    {
        GivenMembership(SystemRoles.Admin);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/reports/summary?from=17-10-2026&to=2026-10-20", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("report.period_invalid");
    }

    private void GivenMembership(SystemRole role) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), role.Role, MembershipStatus.Active, OrganizationStatus.Active, role.Permissions));
}
