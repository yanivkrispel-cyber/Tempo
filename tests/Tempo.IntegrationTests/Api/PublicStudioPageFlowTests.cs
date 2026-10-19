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
/// The public studio page (docs/37 section 4.2, MK2) through the real API host and a migrated PostgreSQL 18: off until
/// the owner turns it on, the studio's face, classes as availability buckets (M-10), an instructor only with their
/// consent (M-14), no person's data, bad ranges, and the per-address limit. Fictional people only.
/// </summary>
public sealed class PublicStudioPageFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task ThePublicPage_ShowsTheStudioAndItsClassesAsBuckets_ToAnyone_AndNothingAboutPeople()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{created.GetProperty("id").GetGuid()}";
        var publicPath = $"/api/v1/public/studios/{slug}";
        var danaId = await JoinAsync(client, studioPath, "dana", "staff");
        await JoinAsync(client, studioPath, "lior", "staff");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור ניסיון", entries = 10, validDays = 30, priceAgorot = 5000 }, HttpStatusCode.Created);
        string[] members = ["m1", "m2", "m3"];
        foreach (var member in members)
        {
            await JoinAsync(client, studioPath, member, "client");
            var person = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{person}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        }

        // 1. Off by default (M-7): the page and its sessions are 404, like an unknown studio.
        (await client.GetAsync(publicPath)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.GetAsync($"{publicPath}/sessions")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 2. On, with an intro offer: the studio's face, and exactly these keys.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, introProductId = card.GetProperty("id").GetGuid() });
        var page = await client.GetAsync(publicPath);
        page.StatusCode.Should().Be(HttpStatusCode.OK);
        page.Headers.CacheControl!.ToString().Should().Contain("max-age=300");
        var studio = JsonSerializer.Deserialize<JsonElement>(await page.Content.ReadAsStringAsync());
        studio.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("slug", "name", "appName", "accentId", "logoUrl", "coverUrl", "timeZone", "introOffer", "openJoin");
        studio.GetProperty("name").GetString().Should().Be("סטודיו נשימה");
        studio.GetProperty("introOffer").GetProperty("name").GetString().Should().Be("שיעור ניסיון");
        studio.GetProperty("introOffer").GetProperty("priceAgorot").GetInt32().Should().Be(5000);
        studio.GetProperty("openJoin").GetBoolean().Should().BeTrue();

        // 3. Four classes in three days: open, few (with the number), full, cancelled. Only Dana gave her consent (M-14).
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime).AddDays(3);
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("dana"), new { headline = "פילאטיס", instagramHandle = "dana.example", publicProfile = true });
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס מכשירים", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        async Task<string> SessionAsync(string start, int capacity, Guid instructor) =>
            $"{studioPath}/sessions/" + (await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
            {
                classTypeId = type.GetProperty("id").GetGuid(),
                localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                localStart = start,
                instructorMembershipId = instructor,
                capacity
            }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var open = await SessionAsync("08:00", 10, danaId);
        var few = await SessionAsync("09:00", 4, danaId);
        var full = await SessionAsync("10:00", 2, danaId);
        var cancelled = await SessionAsync("11:00", 10, danaId);
        await SendAsync(client, HttpMethod.Post, $"{few}/bookings", Customer("m1"), new { }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{full}/bookings", Customer("m2"), new { }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{full}/bookings", Customer("m3"), new { }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{cancelled}/cancel", Customer("owner"), new { reason = "חג" });

        var date = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var list = JsonSerializer.Deserialize<JsonElement>(await client.GetStringAsync($"{publicPath}/sessions?from={date}&to={date}")).GetProperty("items").EnumerateArray().ToList();
        list.Should().HaveCount(4);
        list.Select(s => s.GetProperty("availability").GetString()).Should().Equal("open", "few", "full", "cancelled");
        list[1].GetProperty("spotsLeft").GetInt32().Should().Be(3);
        list[0].GetProperty("spotsLeft").ValueKind.Should().Be(JsonValueKind.Null, "a count shows only when few are left");
        list[2].GetProperty("waitlistOpen").GetBoolean().Should().BeTrue();
        list[0].GetProperty("instructor").GetProperty("displayName").GetString().Should().NotBeNullOrEmpty();
        list[0].GetProperty("instructor").GetProperty("instagramHandle").GetString().Should().Be("dana.example");
        foreach (var session in list)
        {
            session.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                ["id", "startsAt", "minutes", "classType", "roomName", "coverUrl", "instructor", "availability", "spotsLeft", "waitlistOpen", "event"],
                "no roster, booking count or person beyond a consenting instructor");
        }

        // Dana takes her consent back: the class shows without her.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("dana"), new { headline = "פילאטיס", publicProfile = false });
        var one = JsonSerializer.Deserialize<JsonElement>(await client.GetStringAsync($"{publicPath}/sessions/{open.Split('/')[^1]}"));
        one.GetProperty("instructor").ValueKind.Should().Be(JsonValueKind.Null);

        // 4. Bad ranges and another studio's class.
        (await client.GetAsync($"{publicPath}/sessions?from={date}&to={day.AddDays(14):yyyy-MM-dd}")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.GetAsync($"{publicPath}/sessions?from=yesterday")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.GetAsync($"{publicPath}/sessions/{Guid.NewGuid()}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 5. A burst from one address is cut at the limit.
        PublicRateLimitFilter.Reset();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i <= PublicRateLimitFilter.PerMinute; i++)
        {
            statuses.Add((await client.GetAsync(publicPath)).StatusCode);
        }

        statuses.Take(PublicRateLimitFilter.PerMinute).Should().AllSatisfy(s => s.Should().Be(HttpStatusCode.OK));
        statuses[^1].Should().Be(HttpStatusCode.TooManyRequests);
        PublicRateLimitFilter.Reset();
    }

    private async Task<Guid> JoinAsync(HttpClient client, string studioPath, string subject, string role)
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
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
