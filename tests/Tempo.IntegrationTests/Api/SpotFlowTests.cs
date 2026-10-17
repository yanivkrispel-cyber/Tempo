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
/// Rooms with spots (docs/33 section 3) through the real API host and a migrated PostgreSQL 18: a room layout with
/// a spot under maintenance, the usual spot, choosing a spot, what a member and what staff see on the map, the
/// waitlist when every spot is held, promotion into a freed spot, changing a spot, a layout that would strand a
/// booking, and ten members racing for one spot.
/// </summary>
public sealed class SpotFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task ARoomWithSpots_BooksUsualAndChosenSpots_HidesOthers_AndPromotesIntoAFreedSpot()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var members = new[] { "noga", "maya", "yoav", "rina" };
        var (studioPath, roomId, sessionPath) = await StudioAsync(client, members, capacity: 4);

        // 1. Four reformers in a row; the fourth is under maintenance.
        var layout = await SendAsync(client, HttpMethod.Put, $"{studioPath}/rooms/{roomId}/layout", Customer("owner"), new
        {
            spotSelection = true,
            rows = 1,
            cols = 4,
            windowSide = "start",
            mirrorFront = true,
            spots = new object[]
            {
                new { label = "1", row = 0, col = 0, kind = "reformer" },
                new { label = "2", row = 0, col = 1, kind = "reformer" },
                new { label = "3", row = 0, col = 2, kind = "reformer" },
                new { label = "4", row = 0, col = 3, kind = "reformer", status = "maintenance" }
            }
        });
        var spot = layout.GetProperty("spots").EnumerateArray().ToDictionary(s => s.GetProperty("label").GetString()!, s => s.GetProperty("id").GetGuid());
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/rooms/{roomId}/layout", Customer("maya"))).GetProperty("windowSide").GetString().Should().Be("start");
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/rooms/{roomId}/layout", Customer("maya"), new { spots = Array.Empty<object>() }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 2. Noga's usual spot is 2; she books without choosing and gets it. Maya can't take 2, takes 1.
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/me/spot-preferences/{roomId}", Customer("noga"), new { spotId = spot["2"] })).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var noga = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), new { }, HttpStatusCode.Created);
        noga.GetProperty("spot").GetProperty("label").GetString().Should().Be("2");
        (await ProblemCodeAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("maya"), new { spotId = spot["2"] })).Should().Be("booking.spot_unavailable");
        (await ProblemCodeAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("maya"), new { spotId = spot["4"] })).Should().Be("booking.spot_unavailable");
        var maya = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("maya"), new { spotId = spot["1"] }, HttpStatusCode.Created);
        maya.GetProperty("spot").GetProperty("label").GetString().Should().Be("1");

        // 3. A member sees taken spots without names; the instructor sees who and their declaration status.
        var memberMap = await SendAsync(client, HttpMethod.Get, $"{sessionPath}/spots", Customer("noga"));
        memberMap.GetProperty("usualSpotId").GetGuid().Should().Be(spot["2"]);
        memberMap.GetProperty("mySpotId").GetGuid().Should().Be(spot["2"]);
        var states = memberMap.GetProperty("spots").EnumerateArray().ToDictionary(s => s.GetProperty("label").GetString()!, s => s.GetProperty("state").GetString());
        states.Should().Equal(new Dictionary<string, string?> { ["1"] = "taken", ["2"] = "mine", ["3"] = "free", ["4"] = "maintenance" });
        memberMap.GetProperty("spots").EnumerateArray().Single(s => s.GetProperty("label").GetString() == "1").GetProperty("person").ValueKind.Should().Be(JsonValueKind.Null);
        memberMap.GetRawText().Should().NotContain("maya", "a member never learns who holds another spot");
        var staffMap = await SendAsync(client, HttpMethod.Get, $"{sessionPath}/spots", Customer("dana"));
        var one = staffMap.GetProperty("spots").EnumerateArray().Single(s => s.GetProperty("label").GetString() == "1");
        one.GetProperty("person").GetProperty("displayName").GetString().Should().Be("maya");
        one.GetProperty("attendance").GetString().Should().Be("booked");
        one.GetProperty("healthStatus").GetString().Should().Be("missing");

        // 4. Yoav gets the last free spot; Rina finds every spot held (capacity 4, one under maintenance) and waits.
        var yoav = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("yoav"), new { }, HttpStatusCode.Created);
        yoav.GetProperty("spot").GetProperty("label").GetString().Should().Be("3");
        var rina = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("rina"), null, HttpStatusCode.Created);
        rina.GetProperty("status").GetString().Should().Be("waitlisted");
        rina.GetProperty("spot").ValueKind.Should().Be(JsonValueKind.Null);

        // 5. Yoav cancels: Rina is promoted into spot 3.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{yoav.GetProperty("id").GetGuid()}/cancel", Customer("yoav"));
        var rinaNow = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/bookings", Customer("rina"))).GetProperty("items")[0];
        rinaNow.GetProperty("status").GetString().Should().Be("booked");
        rinaNow.GetProperty("spot").GetProperty("label").GetString().Should().Be("3");

        // 6. Spot 4 comes back into service; Noga moves to it. Retiring Maya's spot is refused.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/rooms/{roomId}/layout", Customer("owner"), new
        {
            spotSelection = true,
            rows = 1,
            cols = 4,
            windowSide = "start",
            mirrorFront = true,
            spots = new object[]
            {
                new { id = spot["1"], label = "1", row = 0, col = 0, kind = "reformer" },
                new { id = spot["2"], label = "2", row = 0, col = 1, kind = "reformer" },
                new { id = spot["3"], label = "3", row = 0, col = 2, kind = "reformer" },
                new { id = spot["4"], label = "4", row = 0, col = 3, kind = "reformer" }
            }
        });
        (await ProblemCodeAsync(client, HttpMethod.Put, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/spot", Customer("noga"), new { spotId = spot["3"] })).Should().Be("booking.spot_unavailable");
        (await SendAsync(client, HttpMethod.Put, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/spot", Customer("noga"), new { spotId = spot["4"] }))
            .GetProperty("spot").GetProperty("label").GetString().Should().Be("4");
        (await ProblemCodeAsync(client, HttpMethod.Put, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/spot", Customer("maya"), new { spotId = spot["2"] })).Should().Be("booking.not_found");
        (await ProblemCodeAsync(client, HttpMethod.Put, $"{studioPath}/rooms/{roomId}/layout", Customer("owner"), new
        {
            spotSelection = true,
            rows = 1,
            cols = 4,
            spots = new object[]
            {
                new { id = spot["2"], label = "2", row = 0, col = 1 },
                new { id = spot["3"], label = "3", row = 0, col = 2 },
                new { id = spot["4"], label = "4", row = 0, col = 3 }
            }
        })).Should().Be("room.spot_in_use");

        // 7. The audit has the layout and the spot change, ids only.
        var actions = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("action").GetString()).ToList();
        actions.Should().Contain(["room.layout_updated", "booking.spot_changed", "booking.promoted"]);
    }

    [Fact]
    public async Task TenMembersRacingForOneSpot_OneGetsIt_TheRestKeepTheirPlaceAndEntry()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var members = Enumerable.Range(1, 10).Select(i => $"member{i}").ToArray();
        var (studioPath, roomId, sessionPath) = await StudioAsync(client, members, capacity: 10);
        var layout = await SendAsync(client, HttpMethod.Put, $"{studioPath}/rooms/{roomId}/layout", Customer("owner"), new
        {
            spotSelection = true,
            rows = 2,
            cols = 5,
            spots = Enumerable.Range(0, 10).Select(i => new { label = (i + 1).ToString(CultureInfo.InvariantCulture), row = i / 5, col = i % 5, kind = "reformer" }).ToArray()
        });
        var first = layout.GetProperty("spots").EnumerateArray().First(s => s.GetProperty("label").GetString() == "1").GetProperty("id").GetGuid();

        var responses = await Task.WhenAll(members.Select(m => RawAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer(m), new { spotId = first })));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(9);
        var map = await SendAsync(client, HttpMethod.Get, $"{sessionPath}/spots", Customer("owner"));
        map.GetProperty("spots").EnumerateArray().Count(s => s.GetProperty("state").GetString() != "free").Should().Be(1);
        var session = await SendAsync(client, HttpMethod.Get, sessionPath, Customer("owner"));
        session.GetProperty("bookedCount").GetInt32().Should().Be(1, "a refused spot leaks no place");
        foreach (var member in members)
        {
            var left = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/passes", Customer(member))).GetProperty("items")[0].GetProperty("entriesLeft").GetInt32();
            left.Should().BeOneOf(9, 10);
        }

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

    private static async Task<string?> ProblemCodeAsync(HttpClient client, HttpMethod method, string path, string token, object body)
    {
        var response = await RawAsync(client, method, path, token, body);
        var text = await response.Content.ReadAsStringAsync();
        ((int)response.StatusCode).Should().BeGreaterThanOrEqualTo(400, $"{method} {path} answered {text}");
        return JsonSerializer.Deserialize<JsonElement>(text).GetProperty("code").GetString();
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
