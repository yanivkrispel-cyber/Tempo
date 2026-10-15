using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Tempo.Api.DependencyInjection;
using Tempo.IntegrationTests.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Identity.Application;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// The Phase 2 path through the real API host and a migrated PostgreSQL 18
/// (docs/27): permissions from role assignments, the roles API with step-up,
/// person records and the walk-in invitation, my profile and consent, owner
/// transfer, duplicates and export. Cognito is stood in as in PhaseOneFlowTests.
/// </summary>
public sealed class PhaseTwoFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private static readonly string[] StaffPermissions = ["attendance.mark", "bookings.manage", "members.view", "organization.view", "passes.view", "people.manage", "people.view", "schedule.view"];

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task StudioRunsOnPermissions_PeopleConsentTransferAndMerge()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();

        // 1. A studio with an admin and a staff member, by invitation.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug = "studio-neshima" }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var adminMembership = await JoinByInvitationAsync(client, studioPath, "admin", "admin");
        var staffMembership = await JoinByInvitationAsync(client, studioPath, "staff", "staff");

        // 2. GET /me carries roles and permissions from the role assignments.
        var staffMe = (await SendAsync(client, HttpMethod.Get, "/api/v1/me", Customer("staff"))).GetProperty("memberships")[0];
        staffMe.GetProperty("roles")[0].GetProperty("key").GetString().Should().Be("staff");
        staffMe.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).Should().Equal(StaffPermissions);

        // 3. The roles API: staff may list roles, only the owner reads the catalog.
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/roles", Customer("staff"))).GetProperty("items").GetArrayLength().Should().Be(4);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/permissions", Customer("staff"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 4. Staff record a walk-in; the owner invites her to the app; accepting links that record.
        var walkIn = await SendAsync(client, HttpMethod.Post, $"{studioPath}/people", Customer("staff"), new { displayName = "Dana", phone = "050-2345678" }, HttpStatusCode.Created);
        walkIn.GetProperty("primaryPhone").GetString().Should().Be("+972502345678");
        var walkInPath = $"{studioPath}/people/{walkIn.GetProperty("id").GetGuid()}";
        var personInvite = await SendAsync(client, HttpMethod.Post, $"{walkInPath}/invite", Customer("owner"), new { email = "dana@example.com" }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("dana"));
        await SendAsync(client, HttpMethod.Post, "/api/v1/invitations/accept", Customer("dana"), new { token = personInvite.GetProperty("link").GetString()!.Split('#')[^1] });
        (await SendAsync(client, HttpMethod.Get, walkInPath, Customer("staff"))).GetProperty("hasLogin").GetBoolean().Should().BeTrue();

        // 5. Dana, a client, edits her own record and consent, but cannot see other people.
        var profile = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer("dana"));
        profile.GetProperty("id").GetGuid().Should().Be(walkIn.GetProperty("id").GetGuid());
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/consents", Customer("dana"), new { purpose = "reminders", channel = "push", state = "granted", textVersion = "draft-2026-10-15" }, HttpStatusCode.Created);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/people", Customer("dana"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await SendAsync(client, HttpMethod.Get, $"{walkInPath}/consents", Customer("staff"))).GetProperty("items").GetArrayLength().Should().Be(1);

        // 6. Granting admin needs a recent sign-in.
        var toAdmin = new { roleIds = new[] { Guid.Parse("00000000-0000-7000-8000-000000000002") } };
        var stale = await RawAsync(client, HttpMethod.Put, $"{studioPath}/members/{staffMembership}/roles", Customer("owner"), toAdmin);
        stale.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be("auth.step_up_required");
        var promoted = await SendAsync(client, HttpMethod.Put, $"{studioPath}/members/{staffMembership}/roles", Customer("owner", freshSignIn: true), toAdmin);
        promoted.GetProperty("roles")[0].GetProperty("key").GetString().Should().Be("admin");

        // 7. The owner hands the studio to the first admin, who accepts.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/ownership-transfer", Customer("owner", freshSignIn: true), new { toMembershipId = adminMembership }, HttpStatusCode.Created);
        var incoming = (await SendAsync(client, HttpMethod.Get, "/api/v1/me", Customer("admin"))).GetProperty("memberships")[0].GetProperty("pendingOwnershipTransfer");
        incoming.GetProperty("direction").GetString().Should().Be("incoming");
        (await SendAsync(client, HttpMethod.Post, $"{studioPath}/ownership-transfer/accept", Customer("admin"))).GetProperty("role").GetString().Should().Be("owner");
        (await SendAsync(client, HttpMethod.Get, "/api/v1/me", Customer("owner"))).GetProperty("memberships")[0].GetProperty("role").GetString().Should().Be("admin");

        // 8. Two walk-ins with one phone are flagged; the new owner merges them.
        var first = await SendAsync(client, HttpMethod.Post, $"{studioPath}/people", Customer("admin"), new { displayName = "Yoav", phone = "052-3456789" }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people", Customer("admin"), new { displayName = "Yoav K", phone = "0523456789", email = "yoav@example.com" }, HttpStatusCode.Created);
        var pair = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/duplicate-candidates", Customer("admin"))).GetProperty("items").EnumerateArray().Single();
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/duplicate-candidates/{pair.GetProperty("id").GetGuid()}/resolve", Customer("admin"), new { resolution = "merge", survivorPersonId = first.GetProperty("id").GetGuid() });
        var survivor = await SendAsync(client, HttpMethod.Get, $"{studioPath}/people/{first.GetProperty("id").GetGuid()}", Customer("admin"));
        survivor.GetProperty("primaryEmail").GetString().Should().Be("yoav@example.com");

        // 9. Export needs a recent sign-in and returns the full consent history.
        (await RawAsync(client, HttpMethod.Post, $"{walkInPath}/export", Customer("admin"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var export = await SendAsync(client, HttpMethod.Post, $"{walkInPath}/export", Customer("admin", freshSignIn: true));
        export.GetProperty("consentHistory").GetArrayLength().Should().Be(1);

        // 10. The audit trail has the Phase 2 actions, and no person data in them.
        var audit = await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("admin"));
        var actions = audit.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("action").GetString()).ToList();
        actions.Should().Contain(["person.created", "consent.recorded", "ownership.transferred", "person.merged", "person.exported", "membership.role_changed"]);
        audit.GetRawText().Should().NotContain("+972").And.NotContain("yoav@example.com");
        // The stored data keeps ids only; the actor's name is joined from the account when the log is read.
        string.Join(' ', audit.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("data").GetRawText())).Should().NotContain("dana@example.com");
    }

    private async Task<Guid> JoinByInvitationAsync(HttpClient client, string studioPath, string subject, string role)
    {
        var invitation = await SendAsync(client, HttpMethod.Post, $"{studioPath}/invitations", Customer("owner"), new { email = $"{subject}@example.com", role }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(subject));
        var membership = await SendAsync(client, HttpMethod.Post, "/api/v1/invitations/accept", Customer(subject), new { token = invitation.GetProperty("link").GetString()!.Split('#')[^1] });
        return membership.GetProperty("membershipId").GetGuid();
    }

    private WebApplicationFactory<Program> Factory(MigratedDatabase db)
    {
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("DATABASE_APP_CONNECTION_STRING", db.ConnectionString(DatabaseRole.Application));
            builder.UseSetting("DATABASE_PLATFORM_CONNECTION_STRING", db.ConnectionString(DatabaseRole.Platform));
            builder.UseSetting("COGNITO_CLIENT_IDS", "customer-client");
            builder.UseSetting("COGNITO_OPERATOR_CLIENT_IDS", "operator-client");
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<CognitoOptions>(CognitoAuthentication.CustomerScheme, o => o.Issuer = CustomerIssuer);
                services.PostConfigure<JwtBearerOptions>(CognitoAuthentication.CustomerScheme, o =>
                {
                    o.Authority = null;
                    o.Configuration = new OpenIdConnectConfiguration { Issuer = CustomerIssuer };
                    o.Configuration.SigningKeys.Add(key);
                    o.TokenValidationParameters.ValidIssuer = CustomerIssuer;
                    o.TokenValidationParameters.IssuerSigningKey = key;
                });
                services.AddSingleton<ICognitoUserReader, FakeCognito>();
            });
        });
    }

    /// <summary>A customer access token; <paramref name="freshSignIn"/> sets `auth_time` to now (step-up), otherwise an hour ago.</summary>
    private string Customer(string subject, bool freshSignIn = false)
    {
        var now = DateTime.UtcNow;
        var authTime = new DateTimeOffset(freshSignIn ? now : now.AddHours(-1)).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = CustomerIssuer,
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", subject), new Claim("username", subject), new Claim("token_use", "access"),
                new Claim("client_id", "customer-client"), new Claim("auth_time", authTime)
            ]),
            NotBefore = now.AddMinutes(-1),
            IssuedAt = now.AddMinutes(-1),
            Expires = now.AddMinutes(10),
            SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa) { KeyId = "test-key" }, SecurityAlgorithms.RsaSha256)
        });
    }

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await RawAsync(client, method, path, token, body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(expected, $"{method} {path} answered {text}");
        return text.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(text);
    }

    /// <summary>Every user's email is their username at example.com, verified.</summary>
    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
