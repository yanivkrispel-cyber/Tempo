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
/// The offer join of board #404 (SL-4, SK3) through the real API host and a migrated PostgreSQL 18: joining, taking a
/// listed product to pay at the studio and booking a class happen in one transaction, and on any refusal nothing is
/// joined, granted or booked. A newcomers-only offer is granted once; two joins for a class's last place leave one
/// booked and nothing behind for the other; a studio that asks for a health declaration keeps the join and the pass
/// and says the declaration comes next. Fictional people only.
/// </summary>
public sealed class PublicOfferJoinFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheOfferJoin_JoinsGrantsAndBooksTogether_OrNothingAtAll()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, slug, studioId) = await StudioAsync(client, "owner");
        var join = $"/api/v1/public/studios/{slug}/join";
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        var trial = await ProductAsync(client, studioPath, "3 שיעורי ניסיון", 3);
        var unlisted = await ProductAsync(client, studioPath, "פנימי", 1);
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET public_listed = true, newcomers_only = true, public_order = 0 WHERE id = $1", trial);
        var type = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var open = await SessionAsync(client, studioPath, type, 2, "18:00", 8);
        var owner = (await SendAsync(client, HttpMethod.Get, "/api/v1/me", Customer("owner"))).GetProperty("memberships")[0].GetProperty("membershipId").GetGuid();
        var link = Guid.NewGuid();
        await db.AsMasterAsync("INSERT INTO marketing.links (organization_id, id, code, channel, template, target_kind, target_id, created_by, created_at) VALUES ($1, $2, 'offer001', 'story', 'offer', 'offer', $3, $4, now())", studioId, link, trial, owner);

        // 1. A newcomer takes the offer and books in one call: a pass to pay at the studio, a booked place, both sources.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        var joined = await SendAsync(client, HttpMethod.Post, join, Customer("maya"), new { src = "offer001", productId = trial, sessionId = open });
        joined.GetProperty("created").GetBoolean().Should().BeTrue();
        joined.GetProperty("introPass").GetProperty("toPayAtStudio").GetBoolean().Should().BeTrue();
        joined.GetProperty("booking").GetProperty("status").GetString().Should().Be("booked");
        joined.GetProperty("next").ValueKind.Should().Be(JsonValueKind.Null);
        var booking = joined.GetProperty("booking").GetProperty("bookingId").GetGuid();
        (await db.AsMasterAsync("SELECT source_link_id FROM scheduling.bookings WHERE id = $1", booking)).Should().Be(link, "the booking's last touch");
        (await db.AsMasterAsync("SELECT source_link_id FROM organizations.memberships WHERE id = $1", joined.GetProperty("membershipId").GetGuid())).Should().Be(link, "the membership's first touch");

        // 2. The newcomers' offer once: a second try is 409 and adds nothing.
        await ProblemAsync(client, join, "maya", new { productId = trial }, HttpStatusCode.Conflict, "offer.not_newcomer");
        (await PassesAsync(db, studioId, trial)).Should().Be(1L);

        // 3. Each refusal leaves a newcomer with no membership, no pass and no booking (one newcomer per try).
        var cancelled = await SessionAsync(client, studioPath, type, 3, "18:00", 8);
        await db.AsMasterAsync("UPDATE scheduling.sessions SET status = 'cancelled' WHERE id = $1", cancelled);
        var full = await SessionAsync(client, studioPath, type, 4, "18:00", 1);
        await db.AsMasterAsync("UPDATE scheduling.sessions SET booked_count = capacity WHERE id = $1", full);
        await db.AsMasterAsync("INSERT INTO scheduling.booking_policies (organization_id, waitlist_enabled, updated_at) VALUES ($1, false, now()) ON CONFLICT (organization_id) DO UPDATE SET waitlist_enabled = false", studioId);
        foreach (var who in new[] { "noa", "dan", "ella", "omer" })
        {
            await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(who));
        }

        await ProblemAsync(client, join, "noa", new { productId = unlisted, sessionId = open }, HttpStatusCode.NotFound, "product.not_found");
        await ProblemAsync(client, join, "dan", new { productId = trial, sessionId = cancelled }, HttpStatusCode.Conflict, "session.not_bookable");
        await ProblemAsync(client, join, "ella", new { productId = trial, sessionId = full }, HttpStatusCode.Conflict, "session.full");
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET public_until = current_date - 2 WHERE id = $1", trial);
        await ProblemAsync(client, join, "omer", new { productId = trial, sessionId = open }, HttpStatusCode.Conflict, "offer.ended");
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.memberships WHERE organization_id = $1 AND role = 'client'", studioId))
            .Should().Be(1L, "no refusal joins: maya is the only client");
        (await PassesAsync(db, studioId, trial)).Should().Be(1L, "no refusal grants");
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET public_until = NULL WHERE id = $1", trial);

        // 4. Two newcomers at once for the last place: one is booked; the other gets session.full and keeps nothing.
        var last = await SessionAsync(client, studioPath, type, 5, "18:00", 1);
        string[] racers = ["tal", "lior"];
        foreach (var who in racers)
        {
            await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(who));
        }

        var answers = await Task.WhenAll(racers.Select(who => RawAsync(client, join, Customer(who), new { productId = trial, sessionId = last })));
        answers.Select(a => (int)a.StatusCode).Order().Should().Equal(200, 409);
        (await db.AsMasterAsync("SELECT booked_count FROM scheduling.sessions WHERE id = $1", last)).Should().Be(1);
        (await PassesAsync(db, studioId, trial)).Should().Be(2L, "only the one who got the place got the pass");
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.memberships WHERE organization_id = $1 AND role = 'client'", studioId)).Should().Be(2L, "maya and the one who got the place");

        // 5. A studio that asks for a health declaration: joined and granted, no booking, and the declaration is next.
        await db.AsMasterAsync("UPDATE scheduling.booking_policies SET require_health_declaration = true WHERE organization_id = $1", studioId);
        (await db.AsMasterAsync("SELECT require_health_declaration FROM scheduling.booking_policies WHERE organization_id = $1", studioId)).Should().Be(true);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("gal"));
        var gated = await SendAsync(client, HttpMethod.Post, join, Customer("gal"), new { productId = trial, sessionId = open });
        gated.GetProperty("next").GetString().Should().Be("health_declaration");
        gated.GetProperty("booking").ValueKind.Should().Be(JsonValueKind.Null);
        gated.GetProperty("introPass").GetProperty("passId").GetGuid().Should().NotBeEmpty();
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.bookings b JOIN people.people p ON p.id = b.person_id WHERE p.membership_id = $1", gated.GetProperty("membershipId").GetGuid())).Should().Be(0L);
    }

    private static async Task<long> PassesAsync(MigratedDatabase db, Guid studioId, Guid product) =>
        (long)(await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes WHERE organization_id = $1 AND product_id = $2", studioId, product))!;

    private async Task<Guid> ProductAsync(HttpClient client, string studioPath, string name, int entries) =>
        (await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name, entries, validDays = 35, priceAgorot = 9900 }, HttpStatusCode.Created))
            .GetProperty("id").GetGuid();

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, string path, string token, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body, body.GetType()) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }

    private async Task ProblemAsync(HttpClient client, string path, string who, object body, HttpStatusCode status, string code)
    {
        var response = await RawAsync(client, path, Customer(who), body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(status, text);
        JsonSerializer.Deserialize<JsonElement>(text).GetProperty("code").GetString().Should().Be(code);
    }

    private async Task<(string Path, string Slug, Guid Id)> StudioAsync(HttpClient client, string owner)
    {
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(owner));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer(owner), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var id = created.GetProperty("id").GetGuid();
        return ($"/api/v1/organizations/{id}", slug, id);
    }

    private async Task<Guid> SessionAsync(HttpClient client, string studioPath, Guid classType, int days, string start, int capacity)
    {
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime).AddDays(days);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = classType,
            localDate = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = start,
            capacity
        }, HttpStatusCode.Created);
        return session.GetProperty("id").GetGuid();
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
                services.AddSingleton<IMediaStore>(new InMemoryMediaStore());
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

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, string? token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var request = new HttpRequestMessage(method, path);
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        var response = await client.SendAsync(request);
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
