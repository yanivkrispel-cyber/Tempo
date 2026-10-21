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
/// Share links by intent (board #404 SL-1, SL-8, SL-9, SK4) through the real API host and a migrated PostgreSQL 18: a
/// studio link leads to a class, an offer, the prices or the week, checked against the studio; the report counts by
/// target; a member's invite shows her first name only while she leaves it on; the public lookup says where a code
/// leads and nothing else; preview covers redirect to the studio's own picture or icon. Fictional people only.
/// </summary>
public sealed class LinkTargetsFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task LinksLeadWhereTheOwnerChose_AndAMembersInviteShowsHerFirstNameOnly()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, slug, _) = await StudioAsync(client, "owner");
        var (otherPath, _, _) = await StudioAsync(client, "owner-b");
        var publicPath = $"/api/v1/public/studios/{slug}";
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        var type = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var session = await SessionAsync(client, studioPath, type, 2, "18:00", 8);
        var otherType = (await SendAsync(client, HttpMethod.Post, $"{otherPath}/class-types", Customer("owner-b"), new { name = "יוגה", category = "yoga", color = "sage", defaultMinutes = 60 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var foreignSession = (await SendAsync(client, HttpMethod.Post, $"{otherPath}/sessions", Customer("owner-b"), new
        {
            classTypeId = otherType,
            localDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "08:00",
            capacity = 8
        }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var offer = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "3 שיעורי ניסיון", entries = 3, validDays = 35 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var unlisted = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "פנימי", entries = 1, validDays = 7 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET public_listed = true, newcomers_only = true, public_order = 0 WHERE id = $1", offer);
        var links = $"{studioPath}/marketing/links";

        // 1. Each target has its own address; the id must belong to the studio and fit the kind.
        var toClass = await SendAsync(client, HttpMethod.Post, links, Customer("owner"), new { channel = "story", template = "today", target = new { kind = "session", id = session } }, HttpStatusCode.Created);
        toClass.GetProperty("url").GetString().Should().EndWith($"/s/{slug}/c/{session}?src={toClass.GetProperty("code").GetString()}");
        var toOffer = await SendAsync(client, HttpMethod.Post, links, Customer("owner"), new { channel = "story", template = "offer", target = new { kind = "offer", id = offer } }, HttpStatusCode.Created);
        toOffer.GetProperty("url").GetString().Should().Contain($"/s/{slug}/o/{offer}?src=");
        toOffer.GetProperty("target").GetProperty("kind").GetString().Should().Be("offer");
        (await SendAsync(client, HttpMethod.Post, links, Customer("owner"), new { channel = "bio", target = new { kind = "prices", id = (Guid?)null } }, HttpStatusCode.Created))
            .GetProperty("url").GetString().Should().Contain($"/s/{slug}/prices?src=");
        (await SendAsync(client, HttpMethod.Post, links, Customer("owner"), new { channel = "poster" }, HttpStatusCode.Created))
            .GetProperty("target").GetProperty("kind").GetString().Should().Be("schedule", "no target is the week (one release)");
        await ProblemAsync(client, links, new { channel = "story", target = new { kind = "offer", id = unlisted } }, HttpStatusCode.BadRequest, "target.invalid");
        await ProblemAsync(client, links, new { channel = "story", target = new { kind = "offer", id = (Guid?)null } }, HttpStatusCode.BadRequest, "target.invalid");
        await ProblemAsync(client, links, new { channel = "story", target = new { kind = "prices", id = session } }, HttpStatusCode.BadRequest, "target.invalid");
        await ProblemAsync(client, links, new { channel = "story", target = new { kind = "everything", id = (Guid?)null } }, HttpStatusCode.BadRequest, "target.invalid");
        await ProblemAsync(client, links, new { channel = "story", target = new { kind = "session", id = foreignSession } }, HttpStatusCode.NotFound, "session.not_found");

        // 2. The public lookup says where a code leads, and nothing else; an unknown code is 404.
        var looked = await SendAsync(client, HttpMethod.Get, $"{publicPath}/links/{toOffer.GetProperty("code").GetString()}", null);
        looked.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("target", "inviterFirstName", "reward");
        looked.GetProperty("target").GetProperty("id").GetGuid().Should().Be(offer);
        looked.GetProperty("inviterFirstName").ValueKind.Should().Be(JsonValueKind.Null, "a studio link has no inviter");
        looked.GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null, "a studio link earns no one a reward");
        (await client.GetAsync($"{publicPath}/links/zzzzzzz9")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.GetAsync($"{publicPath}/links/NOT-A-CODE")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 3. A member's invite: her first name while she shows it, nothing once she turns it off.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("noga"));
        var joined = await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer("noga"), new { });
        await db.AsMasterAsync("UPDATE people.people SET display_name = 'נגה כהן' WHERE membership_id = $1", joined.GetProperty("membershipId").GetGuid());
        var invite = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "member_card", sessionId = session });
        invite.GetProperty("showName").GetBoolean().Should().BeTrue();
        invite.GetProperty("target").GetProperty("kind").GetString().Should().Be("session");
        var inviteCode = invite.GetProperty("code").GetString();
        (await SendAsync(client, HttpMethod.Get, $"{publicPath}/links/{inviteCode}", null)).GetProperty("inviterFirstName").GetString().Should().Be("נגה", "the first name only");
        var hidden = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "member_card", sessionId = session, showName = false });
        hidden.GetProperty("code").GetString().Should().Be(inviteCode, "the same link");
        hidden.GetProperty("showName").GetBoolean().Should().BeFalse();
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer("maya"), new { });
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("maya"), new { channel = "member_card", sessionId = session, showName = true });
        var stillHidden = await client.GetAsync($"{publicPath}/links/{inviteCode}");
        stillHidden.Headers.CacheControl!.MaxAge.Should().BeLessThanOrEqualTo(TimeSpan.FromSeconds(60));
        (await stillHidden.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("inviterFirstName").ValueKind.Should().Be(JsonValueKind.Null, "another member's switch reaches only her own link");

        // 4. The report counts by target: maya joined through nothing, a newcomer through the offer link.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("tal"));
        await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer("tal"), new { src = toOffer.GetProperty("code").GetString() });
        var report = await SendAsync(client, HttpMethod.Get, $"{studioPath}/reports/sources?days=7", Customer("owner"));
        var byTarget = report.GetProperty("byTarget").EnumerateArray().ToDictionary(t => t.GetProperty("kind").GetString()!, t => t.GetProperty("members").GetInt32());
        byTarget["offer"].Should().Be(1);
        report.GetProperty("byLink").EnumerateArray().Select(l => l.GetProperty("target").GetProperty("kind").GetString()).Should().Contain("offer");

        // 5. Preview covers: the studio's icon when there is no picture, as a cacheable redirect.
        var noRedirects = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var cover = await noRedirects.GetAsync($"{publicPath}/cover");
        cover.StatusCode.Should().Be(HttpStatusCode.Redirect);
        cover.Headers.Location!.ToString().Should().Be($"/api/v1/public/studios/{slug}/icons/512?v=0");
        cover.Headers.CacheControl!.Public.Should().BeTrue();
        var classCover = await noRedirects.GetAsync($"{publicPath}/sessions/{session}/cover");
        classCover.StatusCode.Should().Be(HttpStatusCode.Redirect);
        (await noRedirects.GetAsync($"{publicPath}/sessions/{foreignSession}/cover")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AReferralShowsTheStudiosReward_AndANameMadeFromAnEmailIsNeverShown()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, slug, _) = await StudioAsync(client, "owner");
        var publicPath = $"/api/v1/public/studios/{slug}";
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true });
        var type = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var session = await SessionAsync(client, studioPath, type, 2, "18:00", 8);
        var gift = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור מתנה", entries = 1, validDays = 30 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();

        // Noga's name is her own; Maya never typed one, so the studio holds the start of her email ("maya").
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("noga"));
        var noga = (await SendAsync(client, HttpMethod.Post, $"{publicPath}/join", Customer("noga"), new { })).GetProperty("membershipId").GetGuid();
        await db.AsMasterAsync("UPDATE people.people SET display_name = 'נגה כהן' WHERE membership_id = $1", noga);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        await SendAsync(client, HttpMethod.Post, $"{publicPath}/join", Customer("maya"), new { });
        var referral = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "referral" })).GetProperty("code").GetString();
        var card = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "member_card", sessionId = session })).GetProperty("code").GetString();
        var mayaCard = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("maya"), new { channel = "member_card", sessionId = session })).GetProperty("code").GetString();
        var staff = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "story" }, HttpStatusCode.Created)).GetProperty("code").GetString();
        async Task<JsonElement> Look(string? code) => await SendAsync(client, HttpMethod.Get, $"{publicPath}/links/{code}", null);

        // 1. No reward chosen: no reward line on any link.
        (await Look(referral)).GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null, "the studio picked no reward (M-17)");

        // 2. The studio picks one: only the member's referral link shows it, by product name only.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, referralRewardProductId = gift });
        var withReward = await Look(referral);
        withReward.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("target", "inviterFirstName", "reward");
        withReward.GetProperty("reward").EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["productName"], "nothing about the member (S-B)");
        withReward.GetProperty("reward").GetProperty("productName").GetString().Should().Be("שיעור מתנה");
        withReward.GetProperty("inviterFirstName").GetString().Should().Be("נגה");
        (await Look(card)).GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null, "a class card earns no reward; only a referral does");
        (await Look(staff)).GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null, "a staff link earns no one a reward (K5-1)");

        // 3. Her name off: the reward stays (it says nothing about her), the name goes.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "referral", showName = false });
        var nameOff = await Look(referral);
        nameOff.GetProperty("inviterFirstName").ValueKind.Should().Be(JsonValueKind.Null);
        nameOff.GetProperty("reward").GetProperty("productName").GetString().Should().Be("שיעור מתנה");

        // 4. A reward product taken off sale is no promise any more.
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET status = 'archived' WHERE id = $1", gift);
        (await Look(referral)).GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null, "an archived product is never granted");

        // 5. A name the studio made from her email is not a first name: strangers never see the start of an address.
        (await Look(mayaCard)).GetProperty("inviterFirstName").ValueKind.Should().Be(JsonValueKind.Null, "'maya' is her email's local part");
        await db.AsMasterAsync("UPDATE people.people SET display_name = 'Maya' WHERE display_name = 'maya'");
        (await Look(mayaCard)).GetProperty("inviterFirstName").ValueKind.Should().Be(JsonValueKind.Null, "the comparison ignores case");
        await db.AsMasterAsync("UPDATE people.people SET display_name = 'מאיה לוי' WHERE display_name = 'Maya'");
        (await Look(mayaCard)).GetProperty("inviterFirstName").GetString().Should().Be("מאיה", "a name she typed");
    }

    private async Task ProblemAsync(HttpClient client, string path, object body, HttpStatusCode status, string code)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body, body.GetType()) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Customer("owner"));
        var response = await client.SendAsync(request);
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
