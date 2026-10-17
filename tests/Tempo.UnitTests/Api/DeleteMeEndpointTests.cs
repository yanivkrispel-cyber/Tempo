using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.Modules.Identity.Application;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// DELETE /api/v1/me (docs/32 section 9) at the API: a recent sign-in first; the Cognito user is deleted only after the
/// database said yes, and a Cognito failure does not undo a deletion that already happened.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed class DeleteMeEndpointTests : IDisposable
{
    private readonly IAccountDeletionService deletion = Substitute.For<IAccountDeletionService>();
    private readonly ICognitoUserDeleter cognito = Substitute.For<ICognitoUserDeleter>();
    private readonly TestApi api;

    public DeleteMeEndpointTests() =>
        api = new TestApi(configure: services =>
        {
            services.AddSingleton(deletion);
            services.AddSingleton(cognito);
        });

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task WithoutARecentSignIn_Is401StepUp_AndNothingIsDeleted()
    {
        var response = await DeleteAsync(DateTimeOffset.UtcNow.AddMinutes(-11));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await response.Content.ReadAsStringAsync()).Should().Contain("auth.step_up_required");
        deletion.ReceivedCalls().Should().BeEmpty();
        cognito.ReceivedCalls().Should().BeEmpty();
    }

    [Fact]
    public async Task ARecentSignIn_DeletesTheAccount_ThenTheCognitoUser()
    {
        var response = await DeleteAsync(DateTimeOffset.UtcNow.AddMinutes(-2));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        Received.InOrder(() =>
        {
            deletion.DeleteMineAsync(Arg.Is<SignIn>(s => s.Subject == "sub-1" && s.Username == "cognito-user-1"), "member@example.com", Arg.Any<CancellationToken>());
            cognito.DeleteAsync(TestApi.CustomerIssuer, "cognito-user-1", Arg.Any<CancellationToken>());
        });
    }

    [Fact]
    public async Task TheSoleOwner_Gets409WithTheStudios_AndKeepsTheirCognitoUser()
    {
        var studio = Guid.CreateVersion7();
        deletion.DeleteMineAsync(Arg.Any<SignIn>(), Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new DomainRuleViolationException(ViolationKind.Conflict, "account.sole_owner", "Transfer ownership first.")
            {
                Extensions = new Dictionary<string, object?> { ["organizationIds"] = new[] { studio } }
            });

        var response = await DeleteAsync(DateTimeOffset.UtcNow.AddMinutes(-2));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync()).Should().Contain("account.sole_owner").And.Contain(studio.ToString());
        cognito.ReceivedCalls().Should().BeEmpty();
    }

    [Fact]
    public async Task ACognitoFailure_AfterTheDatabase_StillAnswers204()
    {
        cognito.DeleteAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>()).ThrowsAsync(new InvalidOperationException("Cognito is down"));

        var response = await DeleteAsync(DateTimeOffset.UtcNow.AddMinutes(-2));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    private async Task<HttpResponseMessage> DeleteAsync(DateTimeOffset authTime)
    {
        var token = api.Token(
            TestApi.CustomerIssuer,
            TestApi.CustomerClient,
            "sub-1",
            "access",
            10,
            new Claim("username", "cognito-user-1"),
            new Claim("auth_time", authTime.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64));
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/me") { Content = JsonContent.Create(new { confirmEmail = "member@example.com" }) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await api.CreateClient().SendAsync(request);
    }
}
