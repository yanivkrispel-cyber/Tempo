using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Domain;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// docs/31 sections 5 and 9 at the API: the answers route needs `health.view` (an admin gets 403 and the service is
/// never asked), the answers are sent `no-store`, and a signature's names and answers reach no log line.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class HealthDeclarationEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid PersonId = Guid.CreateVersion7();

    // A generic name; no real person's data, not even in tests.
    private const string SignedName = "שם לדוגמה בדיקה";

    private readonly IHealthDeclarationService health = Substitute.For<IHealthDeclarationService>();
    private readonly CapturingSink events = new();
    private readonly Serilog.Core.Logger hostLogger;
    private readonly TestApi api;

    public HealthDeclarationEndpointTests()
    {
        hostLogger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(events).CreateLogger();
        api = new TestApi(configure: services =>
        {
            services.AddSingleton(health);
            services.AddSingleton<Serilog.ILogger>(hostLogger);
        });
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, EmailVerified: true));
    }

    public void Dispose()
    {
        api.Dispose();
        hostLogger.Dispose();
    }

    [Fact]
    public async Task Answers_WithoutHealthView_Is403_AndNeverReachesTheService()
    {
        GivenMembership(SystemRoles.Admin);

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/people/{PersonId}/health-declaration/answers", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await health.DidNotReceiveWithAnyArgs().GetAnswersAsync(default!, Guid.Empty, default);
    }

    [Fact]
    public async Task Answers_ForTheOwner_AreSentNoStore()
    {
        GivenMembership(SystemRoles.Owner);
        var now = DateTimeOffset.UtcNow;
        health.GetAnswersAsync(Arg.Any<TenantContext>(), PersonId, Arg.Any<CancellationToken>())
            .Returns(new HealthAnswersView(Guid.CreateVersion7(), "signed", HealthForms.V1, [new HealthAnswerView("q1", false)], SignedName, "self", null, now, now.AddYears(1), null));

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/people/{PersonId}/health-declaration/answers", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
    }

    [Fact]
    public async Task Status_ForStaff_HasNoAnswersOrNames()
    {
        GivenMembership(SystemRoles.Staff);
        health.GetStatusAsync(Arg.Any<TenantContext>(), PersonId, Arg.Any<CancellationToken>())
            .Returns(new HealthStatusView("needs_medical_approval", Guid.CreateVersion7(), 1, "self", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddYears(1), null));

        var response = await api.GetAsync($"/api/v1/organizations/{StudioId}/people/{PersonId}/health-declaration", api.CustomerToken());

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("needs_medical_approval").And.NotContain("answers").And.NotContain("signedName");
    }

    [Fact]
    public async Task Signing_LogsNoNameAndNoAnswer()
    {
        GivenMembership(SystemRoles.Client);
        health.SignMineAsync(Arg.Any<TenantContext>(), Arg.Any<NewHealthDeclaration>(), Arg.Any<CancellationToken>())
            .Returns(new MyHealthDeclarationView(HealthStatusView.Missing, HealthForms.V1, false));
        using var client = api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", api.CustomerToken());

        var response = await client.PostAsJsonAsync(
            $"/api/v1/organizations/{StudioId}/me/health-declaration",
            new
            {
                formVersion = 1,
                answers = HealthForms.V1.Questions.Select(q => new { questionId = q.Id, answer = true }),
                signedName = SignedName,
                signerRole = "self",
                confirmed = true
            });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        await events.WaitForRequestAsync();
        events.Rendered().Should().NotContain(line => line.Contains(SignedName, StringComparison.Ordinal) || line.Contains("\"answer\"", StringComparison.Ordinal));
    }

    private void GivenMembership(SystemRole role) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), role.Role, MembershipStatus.Active, OrganizationStatus.Active, role.Permissions));

    private sealed class CapturingSink : ILogEventSink
    {
        private readonly ConcurrentQueue<LogEvent> events = new();

        public void Emit(LogEvent logEvent) => events.Enqueue(logEvent);

        public IEnumerable<string> Rendered() =>
            events.Select(e => e.RenderMessage(System.Globalization.CultureInfo.InvariantCulture) + " " + string.Join(" ", e.Properties.Select(p => p.Value.ToString())) + " " + e.Exception);

        public async Task WaitForRequestAsync()
        {
            // The request middleware may write its event after the response reaches the client.
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline && !events.Any(e => e.Properties.ContainsKey("StatusCode")))
            {
                await Task.Delay(20);
            }
        }
    }
}
