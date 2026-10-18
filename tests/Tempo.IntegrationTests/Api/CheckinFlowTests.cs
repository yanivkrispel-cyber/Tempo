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
/// Check-in at the door (docs/33 section 8) through the real API host and PostgreSQL 18: the member's rotating code,
/// the instructor's scan marking attendance once, a code shown too early, a member who may not scan, and the limit
/// on invalid codes.
/// </summary>
public sealed class CheckinFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheCode_ChecksInOnce_OnlyWhenTheClassIsOpen_AndOnlyForStaff()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, roomId, _) = await StudioAsync(client, ["noga", "maya"], capacity: 4);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var classTypeId = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/class-types", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
        var dana = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/instructors", Customer("noga"))).GetProperty("items")[0].GetProperty("membershipId").GetGuid();

        async Task<string> OneOffAsync(DateTimeOffset at)
        {
            var local = TimeZoneInfo.ConvertTime(at, israel);
            var created = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
            {
                classTypeId,
                localDate = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                localStart = local.ToString("HH:mm", CultureInfo.InvariantCulture),
                instructorMembershipId = dana,
                roomId,
                capacity = 4
            }, HttpStatusCode.Created);
            return $"{studioPath}/sessions/{created.GetProperty("id").GetGuid()}";
        }

        // 1. A class in 20 minutes: Noga books it, and her code opens it.
        var soon = await OneOffAsync(DateTimeOffset.UtcNow.AddMinutes(20));
        await SendAsync(client, HttpMethod.Post, $"{soon}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        var mine = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/checkin-code", Customer("noga"));
        var code = mine.GetProperty("code").GetString()!;
        code.Should().MatchRegex(@"^TCI1\.[0-9a-f]{32}\.[0-9]{6}$");
        mine.GetProperty("validForSeconds").GetInt32().Should().BeInRange(1, 30);
        mine.GetProperty("openClass").GetProperty("className").GetString().Should().Be("פילאטיס מכשירים");

        // 2. A member can't scan; Dana, the instructor, can. A second scan changes nothing.
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("maya"), new { code })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var scan = await SendAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("dana"), new { code });
        scan.GetProperty("person").GetProperty("displayName").GetString().Should().Be("noga");
        scan.GetProperty("alreadyCheckedIn").GetBoolean().Should().BeFalse();
        scan.GetProperty("healthStatus").GetString().Should().Be("missing");
        (await SendAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("dana"), new { code })).GetProperty("alreadyCheckedIn").GetBoolean().Should().BeTrue();
        (await SendAsync(client, HttpMethod.Get, $"{soon}/roster", Customer("dana"))).GetProperty("booked")[0].GetProperty("status").GetString().Should().Be("attended");

        // 3. Maya's class is in five hours: her code is valid but too early.
        var later = await OneOffAsync(DateTimeOffset.UtcNow.AddHours(5));
        await SendAsync(client, HttpMethod.Post, $"{later}/bookings", Customer("maya"), null, HttpStatusCode.Created);
        var maya = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/checkin-code", Customer("maya"));
        maya.GetProperty("openClass").ValueKind.Should().Be(JsonValueKind.Null);
        maya.GetProperty("nextClass").GetProperty("opensAt").GetDateTimeOffset().Should().BeAfter(DateTimeOffset.UtcNow.AddHours(4));
        (await ProblemCodeAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("owner"), new { code = maya.GetProperty("code").GetString() })).Should().Be("checkin.too_early");

        // 4. Made-up codes: five are refused, the sixth is rate-limited.
        var forged = code[..^6] + (code[^6..] == "000000" ? "000001" : "000000");
        for (var i = 0; i < 5; i++)
        {
            (await RawAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("owner"), new { code = forged })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("owner"), new { code = forged })).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        var actions = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("action").GetString()).ToList();
        actions.Count(a => a == "booking.checked_in").Should().Be(1);
    }

    [Fact]
    public async Task InvalidScans_AreCapped_PerScanner_InParallel_AndPerPerson_AfterTheStaffCheck()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, roomId, _) = await StudioAsync(client, ["noga", "maya", "lior"], capacity: 4);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var classTypeId = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/class-types", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
        var dana = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/instructors", Customer("noga"))).GetProperty("items")[0].GetProperty("membershipId").GetGuid();
        await JoinByInvitationAsync(client, studioPath, "eli", "admin");
        await JoinByInvitationAsync(client, studioPath, "tal", "admin");
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow.AddMinutes(20), israel);
        var created = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId,
            localDate = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = local.ToString("HH:mm", CultureInfo.InvariantCulture),
            instructorMembershipId = dana,
            roomId,
            capacity = 4
        }, HttpStatusCode.Created);
        var soon = $"{studioPath}/sessions/{created.GetProperty("id").GetGuid()}";
        await SendAsync(client, HttpMethod.Post, $"{soon}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{soon}/bookings", Customer("maya"), null, HttpStatusCode.Created);
        async Task<string> CodeAsync(string member) => (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/checkin-code", Customer(member))).GetProperty("code").GetString()!;
        static string Forged(string code) => code[..^6] + (code[^6..] == "000000" ? "000001" : "000000");
        async Task<HttpStatusCode> ScanAsync(string scanner, string code) =>
            (await RawAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer(scanner), new { code })).StatusCode;

        // 1. A member may not scan at all: refused before the code is looked at, and never counted.
        var noga = await CodeAsync("noga");
        for (var i = 0; i < 7; i++)
        {
            (await ScanAsync("maya", Forged(noga))).Should().Be(HttpStatusCode.Forbidden);
        }

        // 2. Valid scans don't count against the scanner: four bad, two good, the fifth bad, then the limit.
        for (var i = 0; i < 4; i++)
        {
            (await ScanAsync("owner", Forged(noga))).Should().Be(HttpStatusCode.BadRequest);
        }

        (await ScanAsync("owner", await CodeAsync("noga"))).Should().Be(HttpStatusCode.OK);
        (await ScanAsync("owner", await CodeAsync("maya"))).Should().Be(HttpStatusCode.OK);
        (await ScanAsync("owner", Forged(noga))).Should().Be(HttpStatusCode.BadRequest);
        (await ProblemCodeAsync(client, HttpMethod.Post, $"{studioPath}/checkins", Customer("owner"), new { code = Forged(noga) })).Should().Be("checkin.too_many_attempts");

        // 3. Per person, across scanners: Noga's code has six invalid scans so far; Dana adds four, the eleventh is
        //    refused although Dana herself is under her own limit, and so is Eli's first. Maya's code is untouched.
        for (var i = 0; i < 4; i++)
        {
            (await ScanAsync("dana", Forged(noga))).Should().Be(HttpStatusCode.BadRequest);
        }

        (await ScanAsync("dana", Forged(noga))).Should().Be(HttpStatusCode.TooManyRequests);
        (await ScanAsync("eli", Forged(noga))).Should().Be(HttpStatusCode.TooManyRequests);
        (await ScanAsync("eli", Forged(await CodeAsync("maya")))).Should().Be(HttpStatusCode.BadRequest);

        // 4. Twelve invalid scans at once from one scanner: no more than five get as far as checking the code.
        var lior = Forged(await CodeAsync("lior"));
        var parallel = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => ScanAsync("tal", lior)));
        parallel.Count(s => s == HttpStatusCode.BadRequest).Should().BeInRange(1, 5);
        parallel.Count(s => s == HttpStatusCode.TooManyRequests).Should().Be(12 - parallel.Count(s => s == HttpStatusCode.BadRequest));
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
