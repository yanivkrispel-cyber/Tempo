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
/// Story suggestions (docs/37 section 7.4, M-13, MK5) through the real API host and a migrated PostgreSQL 18: none while
/// the public page is off; then the weekly story on its day, a place freed after the waitlist closed, and a cancelled
/// class in the next week. Fictional people only.
/// </summary>
public sealed class StorySuggestionsFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string MembersApp = "https://members.test";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheOwner_GetsTheWeeklyStory_APlaceThatFreedUp_AndAChangedTimetable_AsSuggestions()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug = $"studio-{Guid.NewGuid():N}"[..20] }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{created.GetProperty("id").GetGuid()}";
        await JoinAsync(client, studioPath, "noga", "client");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסייה", entries = 10, validDays = 30 }, HttpStatusCode.Created);
        var noga = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query=noga@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{noga}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        async Task<string> SessionAsync(DateTime local) =>
            $"{studioPath}/sessions/" + (await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
            {
                classTypeId = type.GetProperty("id").GetGuid(),
                localDate = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                localStart = local.ToString("HH:mm", CultureInfo.InvariantCulture),
                capacity = 6
            }, HttpStatusCode.Created)).GetProperty("id").GetGuid();

        // Nothing while the public page is off.
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime;
        var soon = await SessionAsync(nowLocal.AddMinutes(100));
        var later = await SessionAsync(nowLocal.AddDays(3).Date.AddHours(18));
        Kinds(await SendAsync(client, HttpMethod.Get, $"{studioPath}/insights/suggestions", Customer("owner"))).Should().NotContain(k => k.StartsWith("story_", StringComparison.Ordinal));

        // The page on, the weekly story due since a minute ago, today.
        var day = new[] { "sun", "mon", "tue", "wed", "thu", "fri", "sat" }[(int)nowLocal.DayOfWeek];
        var weekly = nowLocal.AddMinutes(-1) < nowLocal.Date ? "00:00" : nowLocal.AddMinutes(-1).ToString("HH:mm", CultureInfo.InvariantCulture);
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, suggestWeeklyAt = $"{day} {weekly}" });

        // Noga books the class in 100 minutes and cancels: the waitlist closed two hours before it, so a place freed up.
        var booking = await SendAsync(client, HttpMethod.Post, $"{soon}/bookings", Customer("noga"), new { }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{booking.GetProperty("id").GetGuid()}/cancel", Customer("noga"), new { });
        // A class in three days is cancelled.
        await SendAsync(client, HttpMethod.Post, $"{later}/cancel", Customer("owner"), new { });

        var cards = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/insights/suggestions", Customer("owner"))).GetProperty("items").EnumerateArray().ToList();
        var stories = cards.Where(c => c.GetProperty("kind").GetString()!.StartsWith("story_", StringComparison.Ordinal)).ToDictionary(c => c.GetProperty("kind").GetString()!);
        stories.Keys.Should().BeEquivalentTo("story_weekly", "story_spot_opened", "story_schedule_changed");
        stories["story_spot_opened"].GetProperty("sessionId").GetGuid().ToString().Should().Be(soon.Split('/')[^1]);
        stories["story_spot_opened"].GetProperty("count").GetInt32().Should().Be(6);
        stories["story_schedule_changed"].GetProperty("count").GetInt32().Should().Be(1);
        stories["story_weekly"].GetProperty("count").GetInt32().Should().BeGreaterThanOrEqualTo(1);
    }

    private static List<string> Kinds(JsonElement page) =>
        [.. page.GetProperty("items").EnumerateArray().Select(c => c.GetProperty("kind").GetString()!)];

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
            builder.UseSetting("CLIENT_APP_URL", MembersApp);
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
