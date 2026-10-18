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
/// The owner's console at a glance (docs/33 sections 9 and 10) through the real API host and PostgreSQL 18: sales at
/// list price with the unpriced counted apart, the week's occupancy, the "waiting for you" cards with a free slot,
/// the activity feed, search, the member's twelve weeks, and who may see what.
/// </summary>
public sealed class InsightFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task Sales_Occupancy_Suggestions_Activity_Search_AndProgress()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        string[] members = ["noga", "maya", "rina", "yoav", "tal"];
        var (studioPath, _, sessionPath) = await StudioAsync(client, members, capacity: 1);

        // 1. A priced week pass for Galit, a walk-in with no other pass: it is sold this month, ends within 14 days, and counts at its list price.
        var week = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסיית ניסיון", entries = 2, validDays = 7, priceAgorot = 52000 }, HttpStatusCode.Created);
        var galit = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/people", Customer("owner"), new { displayName = "גלית", email = "galit@example.com" }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{galit}/passes", Customer("owner"), new { productId = week.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        var sales = await SendAsync(client, HttpMethod.Get, $"{studioPath}/insights/sales", Customer("owner"));
        sales.GetProperty("soFarAgorot").GetInt64().Should().Be(52000);
        sales.GetProperty("passesSold").GetInt32().Should().Be(6);
        sales.GetProperty("unpricedCount").GetInt32().Should().Be(5, "the cards from the setup have no price");
        sales.GetProperty("days").EnumerateArray().Last().GetProperty("cumulativeAgorot").GetInt64().Should().Be(52000);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/insights/sales", Customer("noga"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 2. One place, five members: one books, four wait. The class is full with a line.
        foreach (var member in members)
        {
            await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer(member), null, HttpStatusCode.Created);
        }

        var session = await SendAsync(client, HttpMethod.Get, sessionPath, Customer("owner"));
        var occupancy = await SendAsync(client, HttpMethod.Get, $"{studioPath}/insights/occupancy?week={session.GetProperty("localDate").GetString()}", Customer("owner"));
        occupancy.GetProperty("places").GetInt32().Should().Be(1);
        occupancy.GetProperty("capacity").GetInt32().Should().Be(1);
        var cell = occupancy.GetProperty("cells").EnumerateArray().Single();
        cell.GetProperty("part").GetString().Should().Be("evening", "the class starts at 18:00");
        cell.GetProperty("fullWithWaitlist").GetBoolean().Should().BeTrue();

        // 3. The cards: the renewal first (with its amount), then the full class with four waiting and a free slot.
        var cards = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/insights/suggestions", Customer("owner"))).GetProperty("items").EnumerateArray().ToList();
        cards.Select(c => c.GetProperty("kind").GetString()).Should().Equal("passes_ending", "waitlist_pressure");
        cards[0].GetProperty("amountAgorot").GetInt64().Should().Be(52000);
        cards[1].GetProperty("count").GetInt32().Should().Be(4);
        cards[1].GetProperty("people").GetArrayLength().Should().Be(3);
        var slot = cards[1].GetProperty("slot");
        slot.GetProperty("startsAt").GetDateTimeOffset().Should().BeOnOrAfter(session.GetProperty("endsAt").GetDateTimeOffset());
        slot.GetProperty("roomName").GetString().Should().Be("חדר המכשירים");

        // 4. What happens now: the bookings and the sale, newest first, with names.
        var activity = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/insights/activity?limit=50", Customer("owner"))).GetProperty("items").EnumerateArray().ToList();
        activity.Select(a => a.GetProperty("kind").GetString()).Should().Contain(["booking.created", "booking.waitlisted", "pass.granted"]);
        activity.First(a => a.GetProperty("kind").GetString() == "pass.granted" && a.GetProperty("priceAgorot").ValueKind == JsonValueKind.Number)
            .GetProperty("person").GetProperty("displayName").GetString().Should().Be("גלית");
        activity.Select(a => a.GetProperty("at").GetDateTimeOffset()).Should().BeInDescendingOrder();

        // 5. Search: the owner finds people and classes; a member finds classes only.
        var found = await SendAsync(client, HttpMethod.Get, $"{studioPath}/search?q=noga", Customer("owner"));
        found.GetProperty("people")[0].GetProperty("displayName").GetString().Should().Be("noga");
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/search?q=פילאטיס", Customer("owner"))).GetProperty("sessions").GetArrayLength().Should().Be(1);
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/search?q=noga", Customer("maya"))).GetProperty("people").GetArrayLength().Should().Be(0);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/search?q=n", Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 6. The member's twelve weeks, oldest first, ending with this week.
        var weeks = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/progress", Customer("noga"))).GetProperty("weeks").EnumerateArray().ToList();
        weeks.Should().HaveCount(12);
        weeks.Select(w => w.GetProperty("weekStart").GetDateTime()).Should().BeInAscendingOrder();
        weeks.Should().OnlyContain(w => w.GetProperty("weekStart").GetDateTime().DayOfWeek == DayOfWeek.Sunday);
    }

    /// <summary>A studio with instructor Dana, the members with a 10-entry card each, a room and a class in three days.</summary>
    private async Task<(string StudioPath, Guid RoomId, string SessionPath)> StudioAsync(HttpClient client, string[] members, int capacity)
    {
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime).AddDays(3);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug = $"studio-{Guid.NewGuid():N}"[..20] }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var dana = await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסיית 10", entries = 10, validDays = 90 }, HttpStatusCode.Created);
        foreach (var member in members)
        {
            await JoinByInvitationAsync(client, studioPath, member, "client");
            var person = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{person}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        }

        var room = await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("owner"), new { name = "חדר המכשירים", defaultCapacity = capacity }, HttpStatusCode.Created);
        var reformer = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס מכשירים", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = reformer.GetProperty("id").GetGuid(),
            localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "18:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity
        }, HttpStatusCode.Created);
        return (studioPath, room.GetProperty("id").GetGuid(), $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}");
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

    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}
