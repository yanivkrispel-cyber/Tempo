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
/// Links that count and where sign-ups came from (docs/37 section 6, M-4, MK4) through the real API host and a migrated
/// PostgreSQL 18: who may make a link for which class, the members-app URL with its code, and the report per channel and
/// per link from a real join and booking. Fictional people only.
/// </summary>
public sealed class MarketingLinksFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string MembersApp = "https://members.test";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task Links_AreMadeByWhoMayShareTheClass_AndTheReportCountsWhatTheyBrought()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{created.GetProperty("id").GetGuid()}";
        var dana = await JoinAsync(client, studioPath, "dana", "staff");
        var lior = await JoinAsync(client, studioPath, "lior", "staff");
        await JoinAsync(client, studioPath, "noga", "client");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור ניסיון", entries = 1, validDays = 14 }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, introProductId = card.GetProperty("id").GetGuid() });
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime).AddDays(2);
        async Task<Guid> SessionAsync(string start, Guid instructor) =>
            (await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
            {
                classTypeId = type.GetProperty("id").GetGuid(),
                localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                localStart = start,
                instructorMembershipId = instructor,
                capacity = 8
            }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var danasClass = await SessionAsync("08:00", dana);
        var liorsClass = await SessionAsync("09:00", lior);

        // 1. The owner shares the week; Dana shares her own class; neither a member nor Dana may share Lior's (M-4).
        var week = await SendAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "story", template = "week" }, HttpStatusCode.Created);
        week.GetProperty("code").GetString().Should().MatchRegex("^[a-z0-9]{6,10}$");
        week.GetProperty("url").GetString().Should().Be($"{MembersApp}/s/{slug}/?src={week.GetProperty("code").GetString()}");
        var hers = await SendAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("dana"), new { channel = "whatsapp", sessionId = danasClass }, HttpStatusCode.Created);
        hers.GetProperty("url").GetString().Should().Be($"{MembersApp}/s/{slug}/c/{danasClass}?src={hers.GetProperty("code").GetString()}");
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("dana"), new { channel = "story", sessionId = liorsClass })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("dana"), new { channel = "story" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("noga"), new { channel = "story", sessionId = danasClass })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "tiktok" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "story", sessionId = Guid.NewGuid() })).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 2. Maya arrives from the week's story, joins, and books Dana's class from Dana's WhatsApp; she attends.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer("maya"), new { src = week.GetProperty("code").GetString() });
        var booking = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{danasClass}/bookings", Customer("maya"), new { src = hers.GetProperty("code").GetString() }, HttpStatusCode.Created);
        await db.AsMasterAsync("UPDATE scheduling.bookings SET status = 'attended' WHERE id = $1", booking.GetProperty("id").GetGuid());

        // 3. The report: per channel and per link, for the owner only (reports.view).
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/reports/sources", Customer("dana"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/reports/sources?days=9", Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var report = await SendAsync(client, HttpMethod.Get, $"{studioPath}/reports/sources?days=30", Customer("owner"));
        report.GetProperty("days").GetInt32().Should().Be(30);
        var channels = report.GetProperty("byChannel").EnumerateArray().ToDictionary(
            c => c.GetProperty("channel").GetString()!,
            c => $"{c.GetProperty("members").GetInt32()}/{c.GetProperty("bookings").GetInt32()}/{c.GetProperty("attended").GetInt32()}");
        channels.Should().BeEquivalentTo(new Dictionary<string, string> { ["story"] = "1/0/0", ["whatsapp"] = "0/1/1" });
        report.GetProperty("byLink").EnumerateArray().Select(l => l.GetProperty("code").GetString())
            .Should().BeEquivalentTo(week.GetProperty("code").GetString(), hers.GetProperty("code").GetString());

        // 4. The audit names the channel and template, nothing else.
        var audit = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Where(e => e.GetProperty("action").GetString() == "marketing.link.created").Select(e => e.GetProperty("data").GetRawText()).ToList();
        audit.Should().HaveCount(2).And.AllSatisfy(d => d.Should().Contain("channel").And.NotContain(week.GetProperty("code").GetString()!));
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
