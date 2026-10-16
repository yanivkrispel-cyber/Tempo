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
using Tempo.Platform.Modules.Notifications.Application;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// Notification preferences, studio settings and the inbox-only delivery pipeline (docs/30 sections 7 and 8; day
/// board #176, P3) through the real API host and a migrated PostgreSQL 18: every inbox item now has a request and
/// an inbox delivery, the deliver job routes push with the member's choices, nothing leaves the app, a second run
/// does nothing, and erasing the member removes their notification rows.
/// </summary>
public sealed class NotificationFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task Preferences_Settings_AndTheInboxOnlyRouter()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);

        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו גל", slug = "studio-gal" }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var dana = await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        foreach (var member in new[] { "noga", "rina" })
        {
            await JoinByInvitationAsync(client, studioPath, member, "client");
        }

        // 1. Defaults: every group on inbox and push, no own quiet hours, the studio's 22:00 to 08:00.
        var mine = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notification-preferences", Customer("noga"));
        mine.GetProperty("groups").EnumerateArray().Select(g => g.GetProperty("channels").GetProperty("push").GetBoolean()).Should().Equal(true, true, true);
        mine.GetProperty("quietHours").ValueKind.Should().Be(JsonValueKind.Null);
        mine.GetProperty("studioQuietHours").GetProperty("startsLocal").GetString().Should().Be("22:00");
        mine.GetProperty("timeZone").GetString().Should().Be("Asia/Jerusalem");
        mine.GetProperty("version").GetString().Should().Be("0");

        // 2. Rina turns push off for her bookings and sets her own quiet hours; the inbox cannot go off.
        var choice = new
        {
            groups = new[] { new { group = "bookings", channels = new { inbox = true, push = false } } },
            reminders = new { classTomorrow = true, classSoon = false, passEnding = true, entriesLow = true },
            quietHours = new { startsLocal = "23:00", endsLocal = "07:00" }
        };
        var saved = await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/notification-preferences", Customer("rina"), choice, ifMatch: "0");
        saved.GetProperty("version").GetString().Should().Be("1");
        saved.GetProperty("groups")[0].GetProperty("channels").GetProperty("push").GetBoolean().Should().BeFalse();
        saved.GetProperty("reminders").GetProperty("classSoon").GetBoolean().Should().BeFalse();
        saved.GetProperty("quietHours").GetProperty("endsLocal").GetString().Should().Be("07:00");
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/me/notification-preferences", Customer("rina"), choice, ifMatch: "0")).StatusCode.Should().Be(HttpStatusCode.Conflict);
        await ProblemAsync(client, $"{studioPath}/me/notification-preferences", "rina", new
        {
            groups = new[] { new { group = "studio", channels = new { inbox = false, push = true } } },
            choice.reminders,
            quietHours = (object?)null
        }, "preferences.inbox_required");
        await ProblemAsync(client, $"{studioPath}/me/notification-preferences", "rina", new
        {
            choice.groups,
            choice.reminders,
            quietHours = new { startsLocal = "07:00", endsLocal = "07:00" }
        }, "quietHours.invalid");

        // 3. Studio settings: members read them, only settings managers change them.
        var settings = await SendAsync(client, HttpMethod.Get, $"{studioPath}/notification-settings", Customer("noga"));
        settings.GetProperty("reminders").GetProperty("classSoon").GetProperty("hoursBefore").GetInt32().Should().Be(2);
        settings.GetProperty("reminders").GetProperty("classTomorrow").GetProperty("sendAtLocal").GetString().Should().Be("18:00");
        var studioChoice = new
        {
            quietHours = new { startsLocal = "21:30", endsLocal = "08:00" },
            reminders = new
            {
                classTomorrow = new { enabled = true, sendAtLocal = "19:00" },
                classSoon = new { enabled = true, hoursBefore = 3 },
                passEnding = new { enabled = false, daysBefore = 7 },
                entriesLow = new { enabled = true, entriesLeft = 1 }
            }
        };
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("noga"), studioChoice)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var changed = await SendAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("owner"), studioChoice, ifMatch: "0");
        changed.GetProperty("version").GetString().Should().Be("1");
        changed.GetProperty("quietHours").GetProperty("startsLocal").GetString().Should().Be("21:30");
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notification-preferences", Customer("noga"))).GetProperty("studioReminders").GetProperty("passEnding").GetBoolean().Should().BeFalse();
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("owner"), new
        {
            studioChoice.quietHours,
            reminders = new { studioChoice.reminders.classTomorrow, classSoon = new { enabled = true, hoursBefore = 13 }, studioChoice.reminders.passEnding, studioChoice.reminders.entriesLow }
        })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 4. A one-place class: Noga books, Rina waits, Noga cancels and Rina is promoted; the instructor messages the class.
        var room = await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("owner"), new { name = "חדר קטן", defaultCapacity = 1 }, HttpStatusCode.Created);
        var yoga = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "יוגה", category = "yoga", color = "sage", defaultMinutes = 60 }, HttpStatusCode.Created);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = yoga.GetProperty("id").GetGuid(),
            localDate = today.AddDays(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "18:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity = 1
        }, HttpStatusCode.Created);
        var sessionPath = $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}";
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסייה", entries = 5, validDays = 60 }, HttpStatusCode.Created);
        var people = new Dictionary<string, Guid>();
        foreach (var member in new[] { "noga", "rina" })
        {
            people[member] = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{people[member]}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        }

        var noga = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        var rina = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("rina"), null, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/cancel", Customer("noga"));
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/messages", Customer("dana"), new { text = "מביאים מגבת" }, HttpStatusCode.Accepted);

        // 5. The inbox reads as before; each item has its request, keyed by kind, subject, person and the item.
        var inbox = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notifications", Customer("rina"));
        inbox.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("kind").GetString()).Should().BeEquivalentTo("session.message", "booking.promoted");
        var promotion = inbox.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "booking.promoted").GetProperty("id").GetGuid();
        (await db.AsMasterAsync("SELECT r.dedupe_key FROM notifications.requests r JOIN notifications.inbox_items i ON i.request_id = r.id WHERE i.id = $1", promotion))
            .Should().Be($"booking.promoted:{rina.GetProperty("id").GetGuid()}:{people["rina"]}:{promotion}");
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE request_id IS NULL")).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.deliveries WHERE channel = 'inbox' AND status = 'delivered'")).Should().Be(2L);

        // 6. The deliver job: Rina switched push off for bookings; the class message has no device to go to.
        var job = new NotificationDeliveryJob(db, TimeProvider.System);
        (await job.RunAsync(CancellationToken.None)).Should().Be((2, 2));
        (await db.AsMasterAsync("SELECT string_agg(r.kind || '=' || d.skip_reason, ',' ORDER BY r.kind) FROM notifications.deliveries d JOIN notifications.requests r ON r.id = d.request_id WHERE d.channel = 'push'"))
            .Should().Be("booking.promoted=preference_off,session.message=no_subscription");
        (await job.RunAsync(CancellationToken.None)).Should().Be((0, 0), "one push line per request");

        // 7. Erasing Rina takes her preferences, requests and deliveries with her; the studio's settings stay.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{people["rina"]}/erase", Customer("owner", freshSignIn: true), new { reason = "בקשת מחיקה" });
        foreach (var table in new[] { "preferences", "quiet_hours", "reminder_switches", "preference_versions", "requests" })
        {
            (await db.AsMasterAsync($"SELECT count(*) FROM notifications.{table} WHERE person_id = $1", people["rina"])).Should().Be(0L, table);
        }

        (await db.AsMasterAsync("SELECT count(*) FROM notifications.deliveries")).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.studio_settings")).Should().Be(1L);
    }

    private async Task ProblemAsync(HttpClient client, string path, string subject, object body, string code)
    {
        var response = await RawAsync(client, HttpMethod.Put, path, Customer(subject), body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, text);
        JsonSerializer.Deserialize<JsonElement>(text).GetProperty("code").GetString().Should().Be(code);
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

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, string? ifMatch = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
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

    /// <summary>Every user's email is their username at example.com, verified.</summary>
    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
