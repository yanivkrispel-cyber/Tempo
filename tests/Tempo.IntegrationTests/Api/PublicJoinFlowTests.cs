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
using Tempo.Api.Tenancy;
using Tempo.IntegrationTests.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// Open join from the public page (docs/37 section 4.3, M-8, M-9, M-12, MK3) through the real API host and a migrated
/// PostgreSQL 18: who may join, the first touch on the membership, the intro pass once and to pay at the studio, the
/// last touch on the booking, and open join turned off. Fictional people only.
/// </summary>
public sealed class PublicJoinFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task OpenJoin_MakesAClient_WithTheFirstTouch_AndTheIntroPassOnce_ThenTheBookingKeepsTheLastTouch()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioId = created.GetProperty("id").GetGuid();
        var studioPath = $"/api/v1/organizations/{studioId}";
        var join = $"/api/v1/public/studios/{slug}/join";
        var intro = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור ניסיון", entries = 1, validDays = 14 }, HttpStatusCode.Created);
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime).AddDays(2);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = type.GetProperty("id").GetGuid(),
            localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "18:00",
            capacity = 8
        }, HttpStatusCode.Created);
        var owner = (await SendAsync(client, HttpMethod.Get, "/api/v1/me", Customer("owner"))).GetProperty("memberships")[0].GetProperty("membershipId").GetGuid();
        await db.AsMasterAsync(
            "INSERT INTO marketing.links (organization_id, id, code, channel, template, created_by, created_at) VALUES ($1, $2, 'story01', 'story', 'week', $3, now()), ($1, $4, 'whats01', 'whatsapp', null, $3, now())",
            studioId, Guid.NewGuid(), owner, Guid.NewGuid());

        // 1. Signed out is 401; the page off is 403 join.closed; an unverified email is 403.
        (await client.PostAsync(join, null)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        await ProblemAsync(client, join, "maya", HttpStatusCode.Forbidden, "join.closed");
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, introProductId = intro.GetProperty("id").GetGuid() });
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("unverified"));
        await ProblemAsync(client, join, "unverified", HttpStatusCode.Forbidden, "account.email_not_verified");

        // 2. Maya joins from a story: an active client, the story as her first touch, the intro pass to pay at the studio.
        var joined = await SendAsync(client, HttpMethod.Post, join, Customer("maya"), new { src = "story01" });
        joined.GetProperty("organizationId").GetGuid().Should().Be(studioId);
        joined.GetProperty("created").GetBoolean().Should().BeTrue();
        joined.GetProperty("introPass").GetProperty("productName").GetString().Should().Be("שיעור ניסיון");
        joined.GetProperty("introPass").GetProperty("toPayAtStudio").GetBoolean().Should().BeTrue();
        var membership = joined.GetProperty("membershipId").GetGuid();
        (await db.AsMasterAsync("SELECT l.code FROM organizations.memberships m JOIN marketing.links l ON l.id = m.source_link_id WHERE m.id = $1", membership)).Should().Be("story01");
        (await db.AsMasterAsync("SELECT role || ':' || status FROM organizations.memberships WHERE id = $1", membership)).Should().Be("client:active");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes p JOIN people.people pe ON pe.id = p.person_id WHERE pe.membership_id = $1 AND p.to_pay_at_studio", membership)).Should().Be(1L);

        // Joining again changes nothing and grants nothing more.
        var again = await SendAsync(client, HttpMethod.Post, join, Customer("maya"), new { src = "whats01" });
        again.GetProperty("created").GetBoolean().Should().BeFalse();
        again.GetProperty("introPass").ValueKind.Should().Be(JsonValueKind.Null);
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes p JOIN people.people pe ON pe.id = p.person_id WHERE pe.membership_id = $1", membership)).Should().Be(1L);

        // 3. She books from a WhatsApp link: the booking keeps the last touch; an unknown code is ignored.
        var booking = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}/bookings", Customer("maya"), new { src = "whats01" }, HttpStatusCode.Created);
        (await db.AsMasterAsync("SELECT l.code FROM scheduling.bookings b JOIN marketing.links l ON l.id = b.source_link_id WHERE b.id = $1", booking.GetProperty("id").GetGuid())).Should().Be("whats01");

        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("noa"));
        var unknown = await SendAsync(client, HttpMethod.Post, join, Customer("noa"), new { src = "nosuch1" });
        (await db.AsMasterAsync("SELECT source_link_id IS NULL FROM organizations.memberships WHERE id = $1", unknown.GetProperty("membershipId").GetGuid())).Should().Be(true);

        // 4. Open join off: only the join link is left (M-9).
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = false });
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("tal"));
        await ProblemAsync(client, join, "tal", HttpStatusCode.Forbidden, "join.closed");

        // 5. The audit says how she joined, with no address.
        var audit = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray().ToList();
        audit.Select(e => e.GetProperty("action").GetString()).Should().Contain("membership.joined_via_public_page");
        string.Join(' ', audit.Select(e => e.GetProperty("data").GetRawText())).Should().NotContain("@example.com", "the stored data keeps ids only");
        PublicRateLimitFilter.Reset();
    }

    private async Task ProblemAsync(HttpClient client, string path, string who, HttpStatusCode status, string code)
    {
        var response = await RawAsync(client, HttpMethod.Post, path, Customer(who), new { });
        response.StatusCode.Should().Be(status);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be(code);
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
                services.AddSingleton<IMediaStore>(store);
            });
        });
    }

    private string Customer(string subject)
    {
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = CustomerIssuer,
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", subject), new Claim("username", subject), new Claim("token_use", "access"),
                new Claim("client_id", "customer-client"),
                new Claim("auth_time", new DateTimeOffset(now.AddHours(-1)).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture))
            ]),
            NotBefore = now.AddMinutes(-1),
            IssuedAt = now.AddMinutes(-1),
            Expires = now.AddMinutes(10),
            SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa) { KeyId = "test-key" }, SecurityAlgorithms.RsaSha256)
        });
    }

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, string? ifMatch = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK, string? ifMatch = null)
    {
        var response = await RawAsync(client, method, path, token, body, ifMatch);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(expected, $"{method} {path} answered {text}");
        return text.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(text);
    }

    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", username != "unverified"));
    }
}
