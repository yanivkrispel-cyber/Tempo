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
/// The whole Phase 1 path through the real API host and a migrated
/// PostgreSQL 18: DI, both token schemes, the tenant and operator filters,
/// row-level security and the audit trail working together. Only Cognito is
/// stood in: a local signing key for both pools, and a fake AdminGetUser.
/// </summary>
public sealed class PhaseOneFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string OperatorIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Operators";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task OwnerOpensAStudio_StaffAndClientJoin_OperatorSuspendsIt()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();

        // 1. Sessions create accounts just in time.
        var ownerMe = await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        ownerMe.GetProperty("email").GetString().Should().Be("owner@example.com");
        ownerMe.GetProperty("memberships").GetArrayLength().Should().Be(0);

        // 2. The owner opens a studio.
        var studio = await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug = "studio-neshima" }, HttpStatusCode.Created);
        var studioId = studio.GetProperty("id").GetGuid();
        var studioPath = $"/api/v1/organizations/{studioId}";

        // 3. Staff by invitation: the link's fragment is the token, sent in the body.
        var invitation = await SendAsync<JsonElement>(client, HttpMethod.Post, $"{studioPath}/invitations", Customer("owner"), new { email = "staff@example.com", role = "staff" }, HttpStatusCode.Created);
        var token = invitation.GetProperty("link").GetString()!.Split('#')[^1];
        await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/session", Customer("staff"));
        var staffMembership = await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/invitations/accept", Customer("staff"), new { token });
        staffMembership.GetProperty("role").GetString().Should().Be("staff");

        // 4. A client by the join link.
        var joinLink = await SendAsync<JsonElement>(client, HttpMethod.Put, $"{studioPath}/join-link", Customer("owner"));
        var code = joinLink.GetProperty("link").GetString()!.Split('#')[^1];
        await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/session", Customer("client"));
        (await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/join", Customer("client"), new { code })).GetProperty("role").GetString().Should().Be("client");

        // 5. What each one sees.
        var members = await SendAsync<JsonElement>(client, HttpMethod.Get, $"{studioPath}/members", Customer("owner"));
        members.GetProperty("items").GetArrayLength().Should().Be(3);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/members", Customer("client"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/audit-events", Customer("staff"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var audit = await SendAsync<JsonElement>(client, HttpMethod.Get, $"{studioPath}/audit-events", Customer("owner"));
        audit.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("action").GetString())
            .Should().Contain(["organization.created", "invitation.accepted", "membership.joined_via_link", "join_link.rotated"]);

        // 6. A stranger cannot tell the studio exists.
        await SendAsync<JsonElement>(client, HttpMethod.Post, "/api/v1/session", Customer("stranger"));
        var stranger = await RawAsync(client, HttpMethod.Get, studioPath, Customer("stranger"));
        stranger.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 7. The operator console, after a person registers the operator.
        (await RawAsync(client, HttpMethod.Get, "/api/v1/platform/stats", Operator("kris"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await db.AsMasterAsync(
            "INSERT INTO platform_admin.operators (id, email, issuer, subject, status, created_at, updated_at) VALUES ($1, 'kris@example.com', $2, 'kris', 'active', now(), now())",
            Guid.CreateVersion7(),
            OperatorIssuer);
        var seen = await SendAsync<JsonElement>(client, HttpMethod.Get, $"/api/v1/platform/organizations/{studioId}", Operator("kris"));
        seen.GetProperty("memberCounts").GetProperty("client").GetInt32().Should().Be(1);
        (await RawAsync(client, HttpMethod.Get, $"/api/v1/platform/organizations/{studioId}", Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await SendAsync<JsonElement>(client, HttpMethod.Post, $"/api/v1/platform/organizations/{studioId}/suspend", Operator("kris"), new { reason = "end-to-end test" });

        // 8. A suspended studio: its own page still answers, the rest is refused.
        (await RawAsync(client, HttpMethod.Get, studioPath, Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.OK);
        var refused = await RawAsync(client, HttpMethod.Get, $"{studioPath}/members", Customer("owner"));
        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be("organization.suspended");
        var ownerAfter = await SendAsync<JsonElement>(client, HttpMethod.Get, "/api/v1/me", Customer("owner"));
        ownerAfter.GetProperty("memberships")[0].GetProperty("organization").GetProperty("status").GetString().Should().Be("suspended");
    }

    private WebApplicationFactory<Program> Factory(MigratedDatabase db)
    {
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        var app = db.ConnectionString(DatabaseRole.Application);
        var platform = db.ConnectionString(DatabaseRole.Platform);

        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("DATABASE_APP_CONNECTION_STRING", app);
            builder.UseSetting("DATABASE_PLATFORM_CONNECTION_STRING", platform);
            builder.UseSetting("COGNITO_CLIENT_IDS", "customer-client");
            builder.UseSetting("COGNITO_OPERATOR_CLIENT_IDS", "operator-client");
            builder.ConfigureTestServices(services =>
            {
                foreach (var (scheme, issuer) in new[] { (CognitoAuthentication.CustomerScheme, CustomerIssuer), (CognitoAuthentication.OperatorScheme, OperatorIssuer) })
                {
                    services.PostConfigure<CognitoOptions>(scheme, o => o.Issuer = issuer);
                    services.PostConfigure<JwtBearerOptions>(scheme, o =>
                    {
                        o.Authority = null;
                        o.Configuration = new OpenIdConnectConfiguration { Issuer = issuer };
                        o.Configuration.SigningKeys.Add(key);
                        o.TokenValidationParameters.ValidIssuer = issuer;
                        o.TokenValidationParameters.IssuerSigningKey = key;
                    });
                }

                services.AddSingleton<ICognitoUserReader, FakeCognito>();
            });
        });
    }

    private string Customer(string subject) => Token(CustomerIssuer, "customer-client", subject);

    private string Operator(string subject) => Token(OperatorIssuer, "operator-client", subject);

    private string Token(string issuer, string clientId, string subject)
    {
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Subject = new ClaimsIdentity([new Claim("sub", subject), new Claim("username", subject), new Claim("token_use", "access"), new Claim("client_id", clientId)]),
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

    private static async Task<T> SendAsync<T>(HttpClient client, HttpMethod method, string path, string token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await RawAsync(client, method, path, token, body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(expected, $"{method} {path} answered {text}");
        return JsonSerializer.Deserialize<T>(text)!;
    }

    /// <summary>Every user's email is their username at example.com, verified.</summary>
    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
