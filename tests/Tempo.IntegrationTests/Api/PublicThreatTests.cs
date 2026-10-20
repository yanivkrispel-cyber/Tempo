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
/// The threats of board #404 S-3 (K6) that the flow tests don't already cover, through the real API host and a
/// migrated PostgreSQL 18: an unknown and a suspended studio look the same on every public route (S-B), and another
/// studio's session id or source code reaches nothing here. Fictional people only.
/// </summary>
public sealed class PublicThreatTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private static readonly string[] PublicRoutes =
        [string.Empty, "/sessions", $"/sessions/{Guid.NewGuid()}", "/manifest.webmanifest", "/icons/192"];

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task AnUnknownAndASuspendedStudio_AnswerTheSame404_OnEveryPublicRoute()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, slug, studioId) = await StudioAsync(client, "owner");
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        await db.AsMasterAsync("UPDATE organizations.organizations SET status = 'suspended' WHERE id = $1", studioId);

        foreach (var route in PublicRoutes)
        {
            var unknown = await NotFoundAsync(client, $"/api/v1/public/studios/no-such-studio{route}");
            var suspended = await NotFoundAsync(client, $"/api/v1/public/studios/{slug}{route}");
            suspended.Should().BeEquivalentTo(unknown, $"'{route}' must not tell a suspended studio from one that never existed");
        }
    }

    [Fact]
    public async Task AnotherStudiosSessionOrSourceCode_ReachesNothingHere()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (pathA, _, studioA) = await StudioAsync(client, "owner");
        var (pathB, slugB, studioB) = await StudioAsync(client, "owner-b");
        await SendAsync(client, HttpMethod.Put, $"{pathA}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        await SendAsync(client, HttpMethod.Put, $"{pathB}/public-page", Customer("owner-b"), new { enabled = true, openJoin = true });
        var sessionA = await SessionAsync(client, pathA, "owner");
        var sessionB = await SessionAsync(client, pathB, "owner-b");
        var linkA = await SendAsync(client, HttpMethod.Post, $"{pathA}/marketing/links", Customer("owner"), new { channel = "story", template = "week" }, HttpStatusCode.Created);
        var codeA = linkA.GetProperty("code").GetString();

        // Studio A's session is not a session of studio B's public page.
        var crossed = await client.GetAsync($"/api/v1/public/studios/{slugB}/sessions/{sessionA}");
        crossed.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await crossed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be("session.not_found");

        // Studio A's code, sent while joining and booking at studio B, counts for nobody.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        var joined = await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slugB}/join", Customer("maya"), new { src = codeA });
        joined.GetProperty("organizationId").GetGuid().Should().Be(studioB);
        (await db.AsMasterAsync("SELECT source_link_id IS NULL FROM organizations.memberships WHERE id = $1", joined.GetProperty("membershipId").GetGuid()))
            .Should().Be(true, "a code is looked up inside the studio it is sent to");
        var card = await SendAsync(client, HttpMethod.Post, $"{pathB}/pass-products", Customer("owner-b"), new { kind = "punch_card", name = "כרטיסייה", entries = 5, validDays = 30 }, HttpStatusCode.Created);
        var maya = (await SendAsync(client, HttpMethod.Get, $"{pathB}/people?query=maya@example.com", Customer("owner-b"))).GetProperty("items")[0].GetProperty("id").GetGuid();
        await SendAsync(client, HttpMethod.Post, $"{pathB}/people/{maya}/passes", Customer("owner-b"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        var booking = await SendAsync(client, HttpMethod.Post, $"{pathB}/sessions/{sessionB}/bookings", Customer("maya"), new { src = codeA }, HttpStatusCode.Created);
        (await db.AsMasterAsync("SELECT source_link_id IS NULL FROM scheduling.bookings WHERE id = $1", booking.GetProperty("id").GetGuid())).Should().Be(true);

        // And studio A's report counts nothing from studio B.
        var report = await SendAsync(client, HttpMethod.Get, $"{pathA}/reports/sources?days=7", Customer("owner"));
        report.GetProperty("byLink").EnumerateArray().Sum(l => l.GetProperty("members").GetInt32() + l.GetProperty("bookings").GetInt32()).Should().Be(0);
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.memberships WHERE organization_id = $1 AND user_account_id = (SELECT user_account_id FROM organizations.memberships WHERE id = $2)", studioA, joined.GetProperty("membershipId").GetGuid()))
            .Should().Be(0L, "joining B made no membership in A");
    }

    /// <summary>Everything a client can compare about a 404: status, code, title, field names and the caching headers.</summary>
    private static async Task<object> NotFoundAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new
        {
            Status = response.StatusCode,
            Code = body.GetProperty("code").GetString(),
            Title = body.GetProperty("title").GetString(),
            Keys = string.Join(',', body.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal)),
            CacheControl = response.Headers.CacheControl?.ToString(),
            ContentType = response.Content.Headers.ContentType?.MediaType
        };
    }

    private async Task<(string Path, string Slug, Guid Id)> StudioAsync(HttpClient client, string owner)
    {
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(owner));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer(owner), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var id = created.GetProperty("id").GetGuid();
        return ($"/api/v1/organizations/{id}", slug, id);
    }

    private async Task<Guid> SessionAsync(HttpClient client, string studioPath, string owner)
    {
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer(owner), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime).AddDays(2);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer(owner), new
        {
            classTypeId = type.GetProperty("id").GetGuid(),
            localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "18:00",
            capacity = 8
        }, HttpStatusCode.Created);
        return session.GetProperty("id").GetGuid();
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
                services.AddSingleton<IMediaStore>(new InMemoryMediaStore());
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

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(expected, $"{method} {path} answered {text}");
        return text.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(text);
    }

    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
