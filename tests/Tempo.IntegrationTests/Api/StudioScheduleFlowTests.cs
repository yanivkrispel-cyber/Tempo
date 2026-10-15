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
/// The Studio skeleton's demo (docs/29 section 1) through the real API host and a migrated PostgreSQL 18:
/// a weekly class, a punch card granted at the desk, booking from the member app, a full class and its
/// waitlist, a free cancellation that promotes the first in line, the instructor's roster and attendance,
/// and the audit trail. Cognito is stood in as in PhaseOneFlowTests.
/// </summary>
public sealed class StudioScheduleFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task AWeeklyClass_FillsUp_PromotesFromTheWaitlist_AndTakesAttendance()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);

        // 1. A studio with an instructor and three members.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug = "studio-neshima" }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var dana = await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        foreach (var member in new[] { "noga", "yoav", "rina" })
        {
            await JoinByInvitationAsync(client, studioPath, member, "client");
        }

        // 2. A room, a class type and a weekly class taught by Dana, three days from today.
        var room = await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("owner"), new { name = "חדר המכשירים", defaultCapacity = 2 }, HttpStatusCode.Created);
        var reformer = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס מכשירים", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var weekday = (int)today.AddDays(3).DayOfWeek;
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/schedule-templates", Customer("owner"), new
        {
            classTypeId = reformer.GetProperty("id").GetGuid(),
            weekday,
            localStart = "18:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity = 2
        }, HttpStatusCode.Created);
        var day = today.AddDays(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var sessions = await SendAsync(client, HttpMethod.Get, $"{studioPath}/sessions?from={day}&to={day}", Customer("noga"));
        var session = sessions.GetProperty("items").EnumerateArray().Single();
        var sessionPath = $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}";
        session.GetProperty("instructor").GetProperty("membershipId").GetGuid().Should().Be(dana);
        session.GetProperty("passPreview").ValueKind.Should().Be(JsonValueKind.Null, "no pass yet");

        // 3. A punch card, granted at the desk to each member (staff see passes; admins grant them).
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסיית 10", entries = 10, validDays = 90 }, HttpStatusCode.Created);
        foreach (var member in new[] { "noga", "yoav", "rina" })
        {
            var person = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("dana"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            (await RawAsync(client, HttpMethod.Post, $"{studioPath}/people/{person}/passes", Customer("dana"), new { productId = card.GetProperty("id").GetGuid() }))
                .StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{person}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid(), note = "שולם במזומן" }, HttpStatusCode.Created);
        }

        // 4. Two places: Noga and Yoav book from the app, Rina joins the waitlist.
        (await SendAsync(client, HttpMethod.Get, sessionPath, Customer("noga"))).GetProperty("passPreview").GetProperty("entriesLeft").GetInt32().Should().Be(10);
        var noga = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        noga.GetProperty("pass").GetProperty("entriesLeft").GetInt32().Should().Be(9);
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("yoav"), null, HttpStatusCode.Created);
        var rina = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("rina"), null, HttpStatusCode.Created);
        rina.GetProperty("status").GetString().Should().Be("waitlisted");
        (await SendAsync(client, HttpMethod.Get, sessionPath, Customer("rina"))).GetProperty("myBooking").GetProperty("waitlistPosition").GetInt32().Should().Be(1);

        // 5. Noga cancels inside the free window: her entry returns and Rina is promoted and told.
        var cancelled = await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/cancel", Customer("noga"));
        cancelled.GetProperty("lateCancel").GetBoolean().Should().BeFalse();
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/passes", Customer("noga"))).GetProperty("items")[0].GetProperty("entriesLeft").GetInt32().Should().Be(10);
        var inbox = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notifications", Customer("rina"));
        inbox.GetProperty("unreadCount").GetInt32().Should().Be(1);
        inbox.GetProperty("items")[0].GetProperty("kind").GetString().Should().Be("booking.promoted");
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/bookings", Customer("rina"))).GetProperty("items")[0].GetProperty("status").GetString().Should().Be("booked");

        // 6. Dana, the instructor, reads her roster; a member cannot.
        var roster = await SendAsync(client, HttpMethod.Get, $"{sessionPath}/roster", Customer("dana"));
        roster.GetProperty("booked").GetArrayLength().Should().Be(2);
        (await RawAsync(client, HttpMethod.Get, $"{sessionPath}/roster", Customer("yoav"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 7. A one-off class starting soon: Yoav books and Dana marks him attended.
        var soon = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.AddMinutes(20), israel);
        var oneOff = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = reformer.GetProperty("id").GetGuid(),
            localDate = soon.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = soon.ToString("HH:mm", CultureInfo.InvariantCulture),
            instructorMembershipId = dana,
            capacity = 4
        }, HttpStatusCode.Created);
        var yoav = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{oneOff.GetProperty("id").GetGuid()}/bookings", Customer("yoav"), null, HttpStatusCode.Created);
        var attended = await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{yoav.GetProperty("id").GetGuid()}/attendance", Customer("dana"), new { state = "attended" });
        attended.GetProperty("status").GetString().Should().Be("attended");

        // 8. Every step is in the audit log, with ids only.
        var audit = await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"));
        var actions = audit.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("action").GetString()).ToList();
        actions.Should().Contain(["room.created", "class_type.created", "template.created", "pass_product.created", "pass.granted", "booking.created", "booking.waitlisted", "booking.cancelled", "booking.promoted", "booking.attendance_marked"]);
        string.Join(' ', audit.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("data").GetRawText())).Should().NotContain("שולם");
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
