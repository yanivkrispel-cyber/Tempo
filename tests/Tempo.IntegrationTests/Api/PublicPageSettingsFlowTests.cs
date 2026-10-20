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
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// The studio's public page settings and the instructor's public consent (docs/37 sections 4.4 and 5, MK1) through
/// the real API host and a migrated PostgreSQL 18. Fictional people only.
/// </summary>
public sealed class PublicPageSettingsFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task ThePublicPageSettings_AndTheInstructorsPublicConsent_EndToEnd()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, _) = await StudioAsync(client, "סטודיו נשימה");
        var (otherPath, _) = await StudioAsync(client, "סטודיו אחר");
        await JoinByInvitationAsync(client, studioPath, "noga", "client");
        await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור ניסיון", entries = 1, validDays = 30 }, HttpStatusCode.Created);
        var foreign = await SendAsync(client, HttpMethod.Post, $"{otherPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסייה", entries = 1, validDays = 30 }, HttpStatusCode.Created);

        // 1. Defaults until the first save (M-7, M-9): off, open join on. Any member reads it.
        var defaults = await SendAsync(client, HttpMethod.Get, $"{studioPath}/public-page", Customer("noga"));
        defaults.GetProperty("enabled").GetBoolean().Should().BeFalse();
        defaults.GetProperty("openJoin").GetBoolean().Should().BeTrue();
        defaults.GetProperty("introProductId").ValueKind.Should().Be(JsonValueKind.Null);
        defaults.GetProperty("version").GetString().Should().Be("0");

        // 2. Only owners and admins change it; another studio's product or a bad weekly time is refused.
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("dana"), new { enabled = true, openJoin = true })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, introProductId = foreign.GetProperty("id").GetGuid() }, "introProductId.invalid");
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, suggestWeeklyAt = "sunday 9" }, "suggestWeeklyAt.invalid");
        await ProblemAsync(client, $"{studioPath}/public-page", new { openJoin = true }, "enabled.required");

        var saved = await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"),
            new { enabled = true, openJoin = false, introProductId = card.GetProperty("id").GetGuid(), suggestWeeklyAt = "Sun 09:00" }, ifMatch: "0");
        saved.GetProperty("enabled").GetBoolean().Should().BeTrue();
        saved.GetProperty("openJoin").GetBoolean().Should().BeFalse();
        saved.GetProperty("suggestWeeklyAt").GetString().Should().Be("sun 09:00");
        saved.GetProperty("version").GetString().Should().Be("1");
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = false, openJoin = false }, "0")).StatusCode.Should().Be(HttpStatusCode.Conflict);

        // Stage B (docs/37 M-15, M-17): the studio's handle from a link, and a referral reward of its own products only.
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, instagramHandle = "not a handle!" }, "instagramHandle.invalid");
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, referralRewardProductId = foreign.GetProperty("id").GetGuid() }, "referralRewardProductId.invalid");
        var stageB = await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new
        {
            enabled = true,
            openJoin = false,
            introProductId = card.GetProperty("id").GetGuid(),
            suggestWeeklyAt = "sun 09:00",
            instagramHandle = "https://www.instagram.com/neshima.example/",
            referralRewardProductId = card.GetProperty("id").GetGuid()
        });
        stageB.GetProperty("instagramHandle").GetString().Should().Be("neshima.example");
        stageB.GetProperty("referralRewardProductId").GetGuid().Should().Be(card.GetProperty("id").GetGuid());

        // A PUT keeps what it doesn't send (#396 review): a form without the stage B fields leaves them alone, and an
        // explicit null still clears one.
        var partial = await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        partial.GetProperty("openJoin").GetBoolean().Should().BeTrue();
        partial.GetProperty("introProductId").GetGuid().Should().Be(card.GetProperty("id").GetGuid());
        partial.GetProperty("suggestWeeklyAt").GetString().Should().Be("sun 09:00");
        partial.GetProperty("instagramHandle").GetString().Should().Be("neshima.example");
        partial.GetProperty("referralRewardProductId").GetGuid().Should().Be(card.GetProperty("id").GetGuid());
        var cleared = await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, instagramHandle = (string?)null });
        cleared.GetProperty("instagramHandle").ValueKind.Should().Be(JsonValueKind.Null);
        cleared.GetProperty("referralRewardProductId").GetGuid().Should().Be(card.GetProperty("id").GetGuid());

        // 3. The instructor's public profile is her own consent (M-14): default off, she turns it on, a manager can't.
        var dana = (await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("dana"), new { headline = "פילאטיס" }));
        dana.GetProperty("publicProfile").GetBoolean().Should().BeFalse();
        var danaId = dana.GetProperty("membershipId").GetGuid();
        (await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("dana"), new { headline = "פילאטיס", publicProfile = true }))
            .GetProperty("publicProfile").GetBoolean().Should().BeTrue();
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/instructors/{danaId}/profile", Customer("owner"), new { headline = "x", publicProfile = false }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await SendAsync(client, HttpMethod.Put, $"{studioPath}/instructors/{danaId}/profile", Customer("owner"), new { headline = "מורה בכירה" }))
            .GetProperty("publicProfile").GetBoolean().Should().BeTrue("a manager's edit without the field keeps her consent");

        // 4. The audit has field names only.
        var audit = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Where(e => e.GetProperty("action").GetString() == "public_page.updated")
            .Select(e => e.GetProperty("data").GetProperty("fields").EnumerateArray().Select(f => f.GetString()).ToList())
            .ToList();
        audit.Select(fields => string.Join(',', fields.Order(StringComparer.Ordinal))).Should().BeEquivalentTo(
            "enabled,introProductId,openJoin,suggestWeeklyAt",
            "instagramHandle,referralRewardProductId",
            "openJoin",
            "instagramHandle");
    }

    private async Task ProblemAsync(HttpClient client, string path, object body, string code)
    {
        var response = await RawAsync(client, HttpMethod.Put, path, Customer("owner"), body);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be(code);
    }

    private async Task<(string StudioPath, Guid StudioId)> StudioAsync(HttpClient client, string displayName)
    {
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName, slug = $"studio-{Guid.NewGuid():N}"[..20] }, HttpStatusCode.Created);
        var id = studio.GetProperty("id").GetGuid();
        return ($"/api/v1/organizations/{id}", id);
    }

    private async Task JoinByInvitationAsync(HttpClient client, string studioPath, string subject, string role)
    {
        var invitation = await SendAsync(client, HttpMethod.Post, $"{studioPath}/invitations", Customer("owner"), new { email = $"{subject}@example.com", role }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(subject));
        await SendAsync(client, HttpMethod.Post, "/api/v1/invitations/accept", Customer(subject), new { token = invitation.GetProperty("link").GetString()!.Split('#')[^1] });
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
