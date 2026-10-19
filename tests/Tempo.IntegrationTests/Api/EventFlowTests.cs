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
using Tempo.Platform.Modules.Notifications.Application;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// Events and workshops (docs/37 section 8.4, MK8) through the real API host and a migrated PostgreSQL 18: an event's
/// fields on a one-off session, a booking without a pass marked to pay at the studio, the event on the public page,
/// and the reminder a week ahead. Fictional people only.
/// </summary>
public sealed class EventFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string MembersApp = "https://members.test";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task AnEvent_IsBookedWithoutAPass_ToPayAtTheStudio_ShowsPublicly_AndIsRemindedAWeekAhead()
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
        await JoinAsync(client, studioPath, "noga", "client");
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "סדנה", category = "workshop", color = "rose", defaultMinutes = 120 }, HttpStatusCode.Created);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);
        var day = today.AddDays(7);
        object Session(object? sessionEvent) => new
        {
            classTypeId = type.GetProperty("id").GetGuid(),
            localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "11:00",
            capacity = 12,
            @event = sessionEvent
        };

        // 1. An event needs a title; with one, it is a session with its event fields.
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), Session(new { title = "", passRequired = false }))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var workshop = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"),
            Session(new { title = "סדנת נשימה", description = "שעתיים על נשימה ותנועה.", priceAgorot = 12000, passRequired = false }), HttpStatusCode.Created);
        var sessionId = workshop.GetProperty("id").GetGuid();
        workshop.GetProperty("event").GetProperty("title").GetString().Should().Be("סדנת נשימה");
        workshop.GetProperty("event").GetProperty("passRequired").GetBoolean().Should().BeFalse();
        var regular = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), Session(null), HttpStatusCode.Created);
        regular.GetProperty("event").ValueKind.Should().Be(JsonValueKind.Null);

        // 2. Noga has no pass: a regular class refuses her, the event takes her, to pay at the studio.
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{regular.GetProperty("id").GetGuid()}/bookings", Customer("noga"), new { })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var booking = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{sessionId}/bookings", Customer("noga"), new { }, HttpStatusCode.Created);
        booking.GetProperty("toPayAtStudio").GetBoolean().Should().BeTrue();
        booking.GetProperty("pass").ValueKind.Should().Be(JsonValueKind.Null);

        // 3. The public page shows it as an event.
        var date = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var items = JsonSerializer.Deserialize<JsonElement>(await client.GetStringAsync($"/api/v1/public/studios/{slug}/sessions?from={today:yyyy-MM-dd}&to={date}")).GetProperty("items").EnumerateArray().ToList();
        var shown = items.Single(s => s.GetProperty("id").GetGuid() == sessionId);
        shown.GetProperty("event").GetProperty("priceAgorot").GetInt32().Should().Be(12000);
        items.Single(s => s.GetProperty("id").GetGuid() != sessionId).GetProperty("event").ValueKind.Should().Be(JsonValueKind.Null);

        // 4. A week ahead, from 10:00 studio time: one reminder to Noga, once.
        ReminderJob At(int hour) => new(db, new FixedClock(new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(today.ToDateTime(new TimeOnly(hour, 5)), israel))));
        (await At(9).RunAsync(CancellationToken.None)).EventWeek.Should().Be(0);
        (await At(10).RunAsync(CancellationToken.None)).EventWeek.Should().Be(1);
        (await At(11).RunAsync(CancellationToken.None)).EventWeek.Should().Be(0, "the dedupe key holds");
        (await db.AsMasterAsync("SELECT title FROM notifications.inbox_items WHERE organization_id = $1 AND kind = 'reminder.event_week'", studioId)).Should().Be("תזכורת: האירוע בעוד שבוע");
        PublicRateLimitFilter.Reset();
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
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
