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

/// <summary>docs/34 section 3 at the API: a client reaches none of the tag and note routes, and staff can't change the tag list.</summary>
[Collection(ApiHostGroup.Name)]
public sealed class TagsAndNotesEndpointTests : IDisposable
{
    private static readonly Guid AccountId = Guid.CreateVersion7();
    private static readonly Guid StudioId = Guid.CreateVersion7();
    private static readonly Guid PersonId = Guid.CreateVersion7();
    private static readonly Guid TagId = Guid.CreateVersion7();
    private static readonly Guid NoteId = Guid.CreateVersion7();

    private readonly IPeopleTagsAndNotesService service = Substitute.For<IPeopleTagsAndNotesService>();
    private readonly TestApi api;

    public TagsAndNotesEndpointTests()
    {
        api = new TestApi(configure: services => services.AddSingleton(service));
        api.Accounts.FindByExternalIdentityAsync(TestApi.CustomerIssuer, "user-123", Arg.Any<CancellationToken>())
            .Returns(new AccountSnapshot(AccountId, AccountStatus.Active, EmailVerified: true));
    }

    public void Dispose() => api.Dispose();

    public static TheoryData<string, string> EveryRoute => new()
    {
        { "GET", "tags" },
        { "POST", "tags" },
        { "PATCH", $"tags/{TagId}" },
        { "DELETE", $"tags/{TagId}" },
        { "POST", $"people/{PersonId}/tags/{TagId}" },
        { "DELETE", $"people/{PersonId}/tags/{TagId}" },
        { "GET", $"people/{PersonId}/notes" },
        { "POST", $"people/{PersonId}/notes" },
        { "DELETE", $"people/{PersonId}/notes/{NoteId}" },
    };

    [Theory]
    [MemberData(nameof(EveryRoute))]
    public async Task AClient_Gets403OnEveryRoute(string method, string path)
    {
        GivenMembership(SystemRoles.Client);

        var response = await SendAsync(method, path, new { name = "VIP", color = 1, body = "x" });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.ReceivedCalls().Should().BeEmpty();
    }

    [Theory]
    [InlineData("POST", "tags")]
    [InlineData("PATCH", "tags/{0}")]
    [InlineData("DELETE", "tags/{0}")]
    public async Task Staff_CannotChangeTheTagList(string method, string path)
    {
        GivenMembership(SystemRoles.Staff);

        var response = await SendAsync(method, string.Format(System.Globalization.CultureInfo.InvariantCulture, path, TagId), new { name = "VIP", color = 1 });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.ReceivedCalls().Should().BeEmpty();
    }

    [Fact]
    public async Task Staff_CanTagAPerson_AndAddANote()
    {
        GivenMembership(SystemRoles.Staff);
        service.TagPersonAsync(Arg.Any<TenantContext>(), PersonId, TagId, Arg.Any<CancellationToken>()).Returns([new PersonTagView(TagId, "VIP", 3)]);
        service.AddNoteAsync(Arg.Any<TenantContext>(), PersonId, "מעדיפה שורה ראשונה", Arg.Any<CancellationToken>())
            .Returns(new PersonNoteView(NoteId, "מעדיפה שורה ראשונה", DateTimeOffset.UtcNow, Guid.CreateVersion7(), null, "staff", true));

        var tagged = await SendAsync("POST", $"people/{PersonId}/tags/{TagId}", null);
        var noted = await SendAsync("POST", $"people/{PersonId}/notes", new { body = "מעדיפה שורה ראשונה" });

        tagged.StatusCode.Should().Be(HttpStatusCode.OK);
        (await tagged.Content.ReadAsStringAsync()).Should().Contain("\"name\":\"VIP\"");
        noted.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    private async Task<HttpResponseMessage> SendAsync(string method, string path, object? body)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), $"/api/v1/organizations/{StudioId}/{path}");
        if (body is not null && method is "POST" or "PATCH")
        {
            request.Content = JsonContent.Create(body);
        }

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.CustomerToken());
        return await api.CreateClient().SendAsync(request);
    }

    private void GivenMembership(SystemRole role) =>
        api.Memberships.FindAsync(AccountId, StudioId, Arg.Any<CancellationToken>())
            .Returns(new MembershipSnapshot(Guid.CreateVersion7(), role.Role, MembershipStatus.Active, OrganizationStatus.Active, role.Permissions));
}
