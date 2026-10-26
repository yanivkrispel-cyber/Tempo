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
/// The member's side of stage B (docs/37 sections 8.2 and 8.5, MK8) through the real API host and a migrated
/// PostgreSQL 18: one share link per channel, the bring-a-friend reward once for a referred friend's first attended
/// class, and the milestone at 10 attended classes with its numbers. Fictional people only.
/// </summary>
public sealed class MemberStageBFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string MembersApp = "https://members.test";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task AMembersLinks_Milestones_AndTheBringAFriendReward_EndToEnd()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioId = created.GetProperty("id").GetGuid();
        var studioPath = $"/api/v1/organizations/{studioId}";
        await JoinAsync(client, studioPath, "noga", "client");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסיית 20", entries = 20, validDays = 60 }, HttpStatusCode.Created);
        var reward = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור מתנה", entries = 1, validDays = 30 }, HttpStatusCode.Created);
        var noga = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query=noga@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{noga}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new
        {
            enabled = true,
            openJoin = true,
            introProductId = card.GetProperty("id").GetGuid(),
            referralRewardProductId = reward.GetProperty("id").GetGuid()
        });
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var start = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime.AddMinutes(20);
        async Task<Guid> SessionAsync() =>
            (await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
            {
                classTypeId = type.GetProperty("id").GetGuid(),
                localDate = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                localStart = start.ToString("HH:mm", CultureInfo.InvariantCulture),
                capacity = 10
            }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        async Task AttendAsync(string who, Guid session)
        {
            var booking = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{session}/bookings", Customer(who), new { }, HttpStatusCode.Created);
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{booking.GetProperty("id").GetGuid()}/attendance", Customer("owner"), new { state = "attended" });
        }

        // 1. Noga's own links: one per channel, reused; a card names its class.
        var referral = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "referral" });
        referral.GetProperty("url").GetString().Should().Be($"{MembersApp}/s/{slug}/?src={referral.GetProperty("code").GetString()}");
        (await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "referral" })).GetProperty("code").GetString()
            .Should().Be(referral.GetProperty("code").GetString(), "one link per member and channel");
        var first = await SessionAsync();
        var cardLink = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "member_card", sessionId = first });
        cardLink.GetProperty("url").GetString().Should().StartWith($"{MembersApp}/s/{slug}/c/{first}?src=");
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "story" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 2. Maya joins with Noga's referral code; her first attended class rewards Noga once, never naming Maya.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("maya"));
        await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer("maya"), new { src = referral.GetProperty("code").GetString() });
        await AttendAsync("maya", first);
        (await db.AsMasterAsync("SELECT count(*) FROM marketing.referral_rewards WHERE organization_id = $1", studioId)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes WHERE organization_id = $1 AND person_id = $2 AND product_id = $3", studioId, noga, reward.GetProperty("id").GetGuid())).Should().Be(1L);
        (await db.AsMasterAsync("SELECT title FROM notifications.inbox_items WHERE organization_id = $1 AND person_id = $2 AND kind = 'member.referral_rewarded'", studioId, noga))
            .Should().Be("חברה שהזמנת הגיעה לשיעור הראשון");
        await AttendAsync("maya", await SessionAsync());
        (await db.AsMasterAsync("SELECT count(*) FROM marketing.referral_rewards WHERE organization_id = $1", studioId)).Should().Be(1L, "one reward per friend");

        // 3. Noga's tenth attended class is a milestone: one inbox item, and her numbers.
        for (var i = 0; i < 10; i++)
        {
            await AttendAsync("noga", await SessionAsync());
        }

        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE organization_id = $1 AND person_id = $2 AND kind = 'member.milestone'", studioId, noga)).Should().Be(1L);
        var milestones = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/milestones", Customer("noga"));
        milestones.GetProperty("attended").GetInt32().Should().Be(10);
        milestones.GetProperty("reached").EnumerateArray().Select(r => r.GetInt32()).Should().Equal(10);
        milestones.GetProperty("next").GetInt32().Should().Be(25);
        milestones.GetProperty("longestWeekStreak").GetInt32().Should().Be(1);
        milestones.GetProperty("usualTime").GetString().Should().Be(start.ToString("HH:mm", CultureInfo.InvariantCulture));
        milestones.GetProperty("hoursOnTheMat").GetDouble().Should().BeApproximately(10 * 50 / 60.0, 0.1);
    }

    [Fact]
    public async Task ReadingMyReferralLink_WritesNothing_ShowsOnlyMyOwnLink_AndTheStudiosReward()
    {
        // Board #530 (K2, U-2, [O]'s O3 note): the profile's referral card reads its link and the reward in one GET and
        // mints only when the member has no link yet.
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioId = created.GetProperty("id").GetGuid();
        var studioPath = $"/api/v1/organizations/{studioId}";
        await JoinAsync(client, studioPath, "noga", "client");
        await JoinAsync(client, studioPath, "dana", "client");
        var reward = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור מתנה", entries = 1, validDays = 30 }, HttpStatusCode.Created);
        var rewardId = reward.GetProperty("id").GetGuid();
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, referralRewardProductId = rewardId });
        var read = $"{studioPath}/me/share-link?channel=referral";
        async Task<long> LinksAsync() => (long)(await db.AsMasterAsync("SELECT count(*) FROM marketing.links WHERE organization_id = $1", studioId))!;

        // 1. No link yet: the reward, no link, and nothing written.
        var before = await SendAsync(client, HttpMethod.Get, read, Customer("noga"));
        before.GetProperty("link").ValueKind.Should().Be(JsonValueKind.Null);
        before.GetProperty("reward").GetProperty("productName").GetString().Should().Be("שיעור מתנה");
        (await LinksAsync()).Should().Be(0L, "a read never mints");

        // 2. After the mint: the same link the POST made, with its name switch.
        var minted = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "referral", showName = false });
        var code = minted.GetProperty("code").GetString();
        var after = await SendAsync(client, HttpMethod.Get, read, Customer("noga"));
        var link = after.GetProperty("link");
        link.GetProperty("code").GetString().Should().Be(code);
        link.GetProperty("url").GetString().Should().Be($"{MembersApp}/s/{slug}/?src={code}");
        link.GetProperty("channel").GetString().Should().Be("referral");
        link.GetProperty("showName").GetBoolean().Should().BeFalse();
        after.GetProperty("reward").GetProperty("productName").GetString().Should().Be("שיעור מתנה");

        // 3. Only the caller's own referral link: not Noga's for Dana, not Dana's own card, not the studio's links.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/marketing/links", Customer("owner"), new { channel = "story", template = "week" }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("dana"), new { channel = "member_card" });
        (await SendAsync(client, HttpMethod.Get, read, Customer("dana"))).GetProperty("link").ValueKind.Should().Be(JsonValueKind.Null);
        (await SendAsync(client, HttpMethod.Get, read, Customer("owner"))).GetProperty("link").ValueKind.Should().Be(JsonValueKind.Null);
        (await LinksAsync()).Should().Be(3L, "the reads wrote nothing");

        // 4. No reward when the studio picks none, or while its public page is off (the link leads nowhere then).
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = true, openJoin = true, referralRewardProductId = (Guid?)null });
        (await SendAsync(client, HttpMethod.Get, read, Customer("noga"))).GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null);
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new { enabled = false, openJoin = true, referralRewardProductId = rewardId });
        var off = await SendAsync(client, HttpMethod.Get, read, Customer("noga"));
        off.GetProperty("reward").ValueKind.Should().Be(JsonValueKind.Null);
        off.GetProperty("link").GetProperty("code").GetString().Should().Be(code);

        // 5. Only the referral channel, and only for a member of the studio.
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/me/share-link?channel=member_card", Customer("noga"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await RawAsync(client, HttpMethod.Get, $"{studioPath}/me/share-link", Customer("noga"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("stranger"));
        (await RawAsync(client, HttpMethod.Get, read, Customer("stranger"))).StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task TwoAttendanceMarksAtOnce_ForAReferredFriend_RewardTheReferrerOnce_AndBothSucceed()
    {
        // #397 review: the reward was check-then-INSERT, so two marks of the same friend's first classes in parallel
        // made one of them fail on the reward's key and roll the attendance back.
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var created = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו נשימה", slug }, HttpStatusCode.Created);
        var studioId = created.GetProperty("id").GetGuid();
        var studioPath = $"/api/v1/organizations/{studioId}";
        await JoinAsync(client, studioPath, "noga", "client");
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסיית 20", entries = 20, validDays = 60 }, HttpStatusCode.Created);
        var reward = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "שיעור מתנה", entries = 1, validDays = 30 }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new
        {
            enabled = true,
            openJoin = true,
            introProductId = card.GetProperty("id").GetGuid(),
            referralRewardProductId = reward.GetProperty("id").GetGuid()
        });
        var type = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var start = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime.AddMinutes(20);
        var referral = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/share-link", Customer("noga"), new { channel = "referral" });

        // Several friends, so a race that is lost only sometimes still shows.
        for (var friend = 0; friend < 4; friend++)
        {
            var who = $"friend{friend}";
            await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(who));
            await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer(who), new { src = referral.GetProperty("code").GetString() });
            var bookings = new List<Guid>();
            for (var i = 0; i < 2; i++)
            {
                var session = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
                {
                    classTypeId = type.GetProperty("id").GetGuid(),
                    localDate = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    localStart = start.AddMinutes((friend * 2) + i).ToString("HH:mm", CultureInfo.InvariantCulture),
                    capacity = 10
                }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
                bookings.Add((await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{session}/bookings", Customer(who), new { }, HttpStatusCode.Created)).GetProperty("id").GetGuid());
            }

            var marks = await Task.WhenAll(bookings.Select(booking =>
                RawAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{booking}/attendance", Customer("owner"), new { state = "attended" })));
            marks.Select(m => m.StatusCode).Should().AllBeEquivalentTo(HttpStatusCode.OK, $"both marks for {who} succeed");
        }

        (await db.AsMasterAsync("SELECT count(*) FROM marketing.referral_rewards WHERE organization_id = $1", studioId)).Should().Be(4L, "one reward per friend");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes WHERE organization_id = $1 AND product_id = $2", studioId, reward.GetProperty("id").GetGuid()))
            .Should().Be(4L, "no pass without its reward row");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.bookings WHERE organization_id = $1 AND status = 'attended'", studioId)).Should().Be(8L);

        // The same race without the pass row that serializes the HTTP path: two transactions mark one more friend's
        // two bookings, both before either looks at the reward. Both commit, and the referrer is rewarded once.
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("late"));
        await SendAsync(client, HttpMethod.Post, $"/api/v1/public/studios/{slug}/join", Customer("late"), new { src = referral.GetProperty("code").GetString() });
        var late = new List<Guid>();
        for (var i = 0; i < 2; i++)
        {
            var session = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
            {
                classTypeId = type.GetProperty("id").GetGuid(),
                localDate = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                localStart = start.AddMinutes(20 + i).ToString("HH:mm", CultureInfo.InvariantCulture),
                capacity = 10
            }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
            late.Add((await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{session}/bookings", Customer("late"), new { }, HttpStatusCode.Created)).GetProperty("id").GetGuid());
        }

        var owner = (Guid)(await db.AsMasterAsync("SELECT user_account_id FROM organizations.memberships WHERE organization_id = $1 AND role = 'owner'", studioId))!;
        var sources = factory.Services.GetRequiredService<IDataSourceProvider>();
        using var bothMarked = new Barrier(2);
        async Task MarkAsync(Guid booking)
        {
            await using var unitOfWork = await UnitOfWork.BeginAsync(sources, DatabaseRole.Application, owner, studioId, CancellationToken.None);
            await using (var mark = unitOfWork.Command("UPDATE scheduling.bookings SET status = 'attended', updated_at = now() WHERE organization_id = $1 AND id = $2", studioId, booking))
            {
                await mark.ExecuteNonQueryAsync();
            }

            await Task.Run(() => bothMarked.SignalAndWait(TimeSpan.FromSeconds(30)));
            await Tempo.Platform.Modules.Marketing.AttendanceEffects.OnAttendedAsync(unitOfWork, studioId, booking, owner, "test", CancellationToken.None);
            await unitOfWork.CommitAsync(CancellationToken.None);
        }

        await Task.WhenAll(late.Select(booking => Task.Run(() => MarkAsync(booking))));
        (await db.AsMasterAsync("SELECT count(*) FROM marketing.referral_rewards WHERE organization_id = $1", studioId)).Should().Be(5L, "one reward for the fifth friend too");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes WHERE organization_id = $1 AND product_id = $2", studioId, reward.GetProperty("id").GetGuid())).Should().Be(5L);
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
