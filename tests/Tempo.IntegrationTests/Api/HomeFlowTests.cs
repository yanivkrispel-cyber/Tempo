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
/// The member home in one read (S-2, board #511): `GET /me/home` answers with exactly what the eight reads the home
/// made before would answer, for the same caller, so the app can fill each of their caches from it.
/// </summary>
public sealed class HomeFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheHome_IsTheEightReadsInOne_ForAMemberAndForTheOwner()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, _, sessionPath) = await StudioAsync(client, ["noga", "maya"], capacity: 1);
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("maya"), null, HttpStatusCode.Created);

        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);
        var from = today.AddDays(-(int)today.DayOfWeek).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var to = today.AddDays(6 - (int)today.DayOfWeek).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        foreach (var who in new[] { "noga", "maya", "owner" })
        {
            var home = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/home", Customer(who));

            Same(home.GetProperty("studio"), await SendAsync(client, HttpMethod.Get, studioPath, Customer(who)));
            Same(home.GetProperty("upcomingBookings"), (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/bookings?scope=upcoming&limit=100", Customer(who))).GetProperty("items"));
            home.GetProperty("week").GetProperty("from").GetString().Should().Be(from, "the week starts on the studio's Sunday");
            home.GetProperty("week").GetProperty("to").GetString().Should().Be(to);
            Same(home.GetProperty("week").GetProperty("sessions"), (await SendAsync(client, HttpMethod.Get, $"{studioPath}/sessions?from={from}&to={to}", Customer(who))).GetProperty("items"));
            Same(home.GetProperty("progress"), await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/progress", Customer(who)));
            Same(home.GetProperty("passes"), (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/passes", Customer(who))).GetProperty("items"));
            Same(home.GetProperty("profile"), await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer(who)));
            Same(home.GetProperty("notifications"), await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notifications?limit=30", Customer(who)));
            Same(home.GetProperty("instructors"), (await SendAsync(client, HttpMethod.Get, $"{studioPath}/instructors", Customer(who))).GetProperty("items"));
        }

        var noga = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/home", Customer("noga"));
        noga.GetProperty("upcomingBookings")[0].GetProperty("status").GetString().Should().Be("booked");
        var maya = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/home", Customer("maya"));
        maya.GetProperty("upcomingBookings")[0].GetProperty("status").GetString().Should().Be("waitlisted", "each caller gets their own home");
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("stranger"));
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/me/home", Customer("stranger"))).StatusCode.Should().Be(HttpStatusCode.NotFound, "not a member of this studio");
    }

    private static void Same(JsonElement actual, JsonElement expected) =>
        JsonSerializer.Serialize(actual).Should().Be(JsonSerializer.Serialize(expected));

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
