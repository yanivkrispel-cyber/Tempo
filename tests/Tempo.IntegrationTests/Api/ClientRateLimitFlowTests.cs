using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
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
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// The per-client limits of board #404 S-A (K4) through the real API host and a migrated PostgreSQL 18: joining a
/// studio from its public page is counted per source address and per user, making share links per user, each in a
/// fixed window held in the database (so every Lambda instance sees the same count), and the 429 says when to try
/// again. The counters keep a hash, never an address. Fictional people only.
/// </summary>
public sealed class ClientRateLimitFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string TestIpHeader = "X-Test-Client-Ip";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task Joining_IsLimitedPerUser_AndPerSourceAddress_With429AndRetryAfter()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db, ("RateLimits:JoinPerUserPerHour", "3"), ("RateLimits:JoinPerIpPerHour", "5"));
        var client = factory.CreateClient();
        var (_, slug) = await StudioAsync(client);
        var join = $"/api/v1/public/studios/{slug}/join";

        // One user from one address: three joins answer (the first creates, the others return the membership), the fourth is 429.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        for (var i = 0; i < 3; i++)
        {
            (await RawAsync(client, HttpMethod.Post, join, Customer("maya"), ip: "198.51.100.7")).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var limited = await RawAsync(client, HttpMethod.Post, join, Customer("maya"), ip: "198.51.100.8");
        limited.StatusCode.Should().Be((HttpStatusCode)429, "the user's limit holds from any address");
        (await limited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be("rate_limited");
        limited.Headers.RetryAfter!.Delta!.Value.Should().BeGreaterThan(TimeSpan.Zero).And.BeLessThanOrEqualTo(TimeSpan.FromHours(1));

        // Many users from one address: the address has two joins left (three were maya's from .7), then 429.
        foreach (var who in new[] { "noa", "tal" })
        {
            await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(who));
            (await RawAsync(client, HttpMethod.Post, join, Customer(who), ip: "198.51.100.7")).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("lior"));
        (await RawAsync(client, HttpMethod.Post, join, Customer("lior"), ip: "198.51.100.7")).StatusCode.Should().Be((HttpStatusCode)429, "the address's limit holds for any user");
        (await RawAsync(client, HttpMethod.Post, join, Customer("lior"), ip: "203.0.113.20")).StatusCode.Should().Be(HttpStatusCode.OK, "another address is its own count");

        // The counters keep a SHA-256 of the client, never the address or the user's id.
        var keys = await db.AsMasterAsync("SELECT string_agg(encode(client_key, 'escape'), '|') FROM identity.rate_counters") as string;
        keys.Should().NotContain("198.51.100.7").And.NotContain("203.0.113.20");
        (await db.AsMasterAsync("SELECT bool_and(length(client_key) = 32) FROM identity.rate_counters")).Should().Be(true);
    }

    [Fact]
    public async Task MakingShareLinks_IsLimitedPerUser()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db, ("RateLimits:LinksPerUserPerHour", "3"));
        var client = factory.CreateClient();
        var (studioPath, _) = await StudioAsync(client);

        for (var i = 0; i < 3; i++)
        {
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "story", template = "week" }, HttpStatusCode.Created);
        }

        var limited = await RawAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "story", template = "week" });
        limited.StatusCode.Should().Be((HttpStatusCode)429);
        limited.Headers.RetryAfter!.Delta!.Value.Should().BeGreaterThan(TimeSpan.Zero);
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("owner"), new { channel = "referral" })).StatusCode
            .Should().Be((HttpStatusCode)429, "a member's own link counts against the same limit");
    }

    [Fact]
    public async Task ReadingMyShareLink_IsOffTheLinkLimit()
    {
        // Board #530 (K2, [O]'s finding): the profile reads the referral card on every visit, so only a mint may count.
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db, ("RateLimits:LinksPerUserPerHour", "1"));
        var client = factory.CreateClient();
        var (studioPath, _) = await StudioAsync(client);
        var read = $"{studioPath}/me/share-link?channel=referral";

        for (var i = 0; i < 5; i++)
        {
            (await RawAsync(client, HttpMethod.Get, read, Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("owner"), new { channel = "referral" })).StatusCode
            .Should().Be(HttpStatusCode.OK, "five reads left the one mint of the hour untouched");
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("owner"), new { channel = "referral" })).StatusCode
            .Should().Be((HttpStatusCode)429);
        (await RawAsync(client, HttpMethod.Get, read, Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.OK, "a read still answers over the limit");
    }

    private async Task<(string StudioPath, string Slug)> StudioAsync(HttpClient client)
    {
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{created.GetProperty("id").GetGuid()}";
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        return (studioPath, slug);
    }

    private WebApplicationFactory<Program> Factory(MigratedDatabase db, params (string Key, string Value)[] settings)
    {
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("DATABASE_APP_CONNECTION_STRING", db.ConnectionString(DatabaseRole.Application));
            builder.UseSetting("DATABASE_PLATFORM_CONNECTION_STRING", db.ConnectionString(DatabaseRole.Platform));
            builder.UseSetting("COGNITO_CLIENT_IDS", "customer-client");
            builder.UseSetting("COGNITO_OPERATOR_CLIENT_IDS", "operator-client");
            foreach (var (name, value) in settings)
            {
                builder.UseSetting(name, value);
            }

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
                services.AddSingleton<IStartupFilter, TestClientAddress>();
            });
        });
    }

    /// <summary>The test server has no client address; a test header plays API Gateway's source IP.</summary>
    private sealed class TestClientAddress : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, following) =>
            {
                if (context.Request.Headers.TryGetValue(TestIpHeader, out var value) && IPAddress.TryParse(value.ToString(), out var address))
                {
                    context.Connection.RemoteIpAddress = address;
                }

                await following(context);
            });
            next(app);
        };
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

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, string? ip = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (ip is not null)
        {
            request.Headers.TryAddWithoutValidation(TestIpHeader, ip);
        }

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

    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
