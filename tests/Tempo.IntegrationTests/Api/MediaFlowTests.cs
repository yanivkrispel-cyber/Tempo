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
using SkiaSharp;
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// Pictures, instructor profiles and the instructor's note (docs/33 sections 5 to 7) through the real API host,
/// a migrated PostgreSQL 18 and an in-memory picture store: a class cover replaced and re-encoded, a file that is
/// not a picture, who may set which picture, an instructor's profile with checked links, avatars on the staff map,
/// and a note on a class.
/// </summary>
public sealed class MediaFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task Pictures_Profiles_AndNotes_EndToEnd()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, roomId, sessionPath) = await StudioAsync(client, ["noga"], capacity: 4);
        var classTypeId = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/class-types", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();

        // 1. The owner sets a class cover: ticket, upload, finalize. The original is gone; WebP in two sizes stays.
        var cover = await UploadAsync(client, studioPath, "owner", "class_cover", classTypeId, Png(2400, 1600));
        cover.GetProperty("width").GetInt32().Should().Be(1600);
        cover.GetProperty("height").GetInt32().Should().Be(1067);
        var coverId = cover.GetProperty("id").GetGuid();
        store.Keys.Should().Contain([MediaKeys.Large(StudioOf(studioPath), coverId), MediaKeys.Small(StudioOf(studioPath), coverId)]).And.NotContain(MediaKeys.Incoming(StudioOf(studioPath), coverId));
        var small = await store.ReadAsync(MediaKeys.Small(StudioOf(studioPath), coverId), int.MaxValue, CancellationToken.None);
        small![8..12].Should().Equal("WEBP"u8.ToArray());
        var types = await SendAsync(client, HttpMethod.Get, $"{studioPath}/class-types", Customer("noga"));
        types.GetProperty("items")[0].GetProperty("coverSmallUrl").GetString().Should().Contain(MediaKeys.Small(StudioOf(studioPath), coverId));
        (await SendAsync(client, HttpMethod.Get, sessionPath, Customer("noga"))).GetProperty("classType").GetProperty("coverUrl").GetString().Should().Contain(MediaKeys.Large(StudioOf(studioPath), coverId));

        // A new cover replaces the old one and deletes its objects.
        var second = (await UploadAsync(client, studioPath, "owner", "class_cover", classTypeId, Png(800, 800))).GetProperty("id").GetGuid();
        store.Keys.Should().Contain(MediaKeys.Large(StudioOf(studioPath), second)).And.NotContain(MediaKeys.Large(StudioOf(studioPath), coverId));

        // 2. A member can't set a class cover; a file that isn't a picture is refused at finalize.
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("noga"), new { purpose = "class_cover", ownerId = classTypeId, contentType = "image/png", bytes = 100 }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var ticket = await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("owner"), new { purpose = "class_cover", ownerId = classTypeId, contentType = "image/png", bytes = 100 }, HttpStatusCode.Created);
        var bogus = ticket.GetProperty("mediaId").GetGuid();

        // The ticket is a presigned POST whose policy caps the size at S3 (#345); there is no PUT any more.
        ticket.GetProperty("maxBytes").GetInt32().Should().Be(MediaService.MaxUploadBytes);
        var form = ticket.GetProperty("uploadForm");
        form.GetProperty("url").GetString().Should().StartWith("https://media.test/");
        form.GetProperty("fields").GetProperty("key").GetString().Should().Be(MediaKeys.Incoming(StudioOf(studioPath), bogus));
        form.GetProperty("fields").GetProperty("Content-Type").GetString().Should().Be("image/png");
        ticket.TryGetProperty("uploadUrl", out _).Should().BeFalse();
        store.Upload(MediaKeys.Incoming(StudioOf(studioPath), bogus), "<script>alert(1)</script> this is not a png"u8.ToArray());
        var refused = await RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads/{bogus}/finalize", Customer("owner"));
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        store.Keys.Should().NotContain(MediaKeys.Incoming(StudioOf(studioPath), bogus));

        // 3. Dana writes her profile; a link that is not a music service is refused; she sets her own photo.
        var dana = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/instructors", Customer("noga"))).GetProperty("items")[0].GetProperty("membershipId").GetGuid();
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("dana"), new { playlistUrl = "https://evil.example.com/list" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var profile = await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("dana"), new
        {
            headline = "מורה לפילאטיס מכשירים",
            bio = "עשר שנים על הרפורמר.",
            instagramHandle = "https://www.instagram.com/dana.pilates/",
            playlistUrl = "https://open.spotify.com/playlist/37i9dQZF1DX9uKNf5jGX6m"
        });
        profile.GetProperty("instagramHandle").GetString().Should().Be("dana.pilates");
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/me/staff-profile", Customer("noga"), new { headline = "x" })).StatusCode.Should().Be(HttpStatusCode.NotFound);
        await UploadAsync(client, studioPath, "dana", "instructor_photo", dana, Png(600, 800));
        var seen = await SendAsync(client, HttpMethod.Get, $"{studioPath}/instructors/{dana}", Customer("noga"));
        seen.GetProperty("photoSmallUrl").GetString().Should().StartWith("https://media.test/media/");
        seen.GetProperty("playlistUrl").GetString().Should().StartWith("https://open.spotify.com/");
        seen.GetProperty("nextSessions").GetArrayLength().Should().Be(1);

        // 4. Noga sets her avatar; staff see it on the room map.
        var nogaId = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer("noga"))).GetProperty("id").GetGuid();
        await UploadAsync(client, studioPath, "noga", "avatar", nogaId, Png(500, 500));
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer("noga"))).GetProperty("avatarUrl").GetString().Should().StartWith("https://media.test/");
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/rooms/{roomId}/layout", Customer("owner"), new
        {
            spotSelection = true,
            rows = 1,
            cols = 2,
            spots = new object[] { new { label = "1", row = 0, col = 0 }, new { label = "2", row = 0, col = 1 } }
        });
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), new { }, HttpStatusCode.Created);
        var map = await SendAsync(client, HttpMethod.Get, $"{sessionPath}/spots", Customer("dana"));
        map.GetProperty("spots")[0].GetProperty("person").GetProperty("avatarUrl").GetString().Should().Contain("/small.webp");

        // 5. Dana's note: members see it on the class; a member can't write one.
        var noted = await SendAsync(client, HttpMethod.Put, $"{sessionPath}/member-note", Customer("dana"), new { note = "להביא גרביים נגד החלקה" });
        noted.GetProperty("memberNote").GetString().Should().Be("להביא גרביים נגד החלקה");
        (await SendAsync(client, HttpMethod.Get, sessionPath, Customer("noga"))).GetProperty("memberNote").GetString().Should().Be("להביא גרביים נגד החלקה");
        (await RawAsync(client, HttpMethod.Put, $"{sessionPath}/member-note", Customer("noga"), new { note = "x" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // The studio's own cover is the owner's to set (organization.settings.manage).
        var studioId = Guid.Parse(studioPath.Split('/')[^1]);
        (await UploadAsync(client, studioPath, "owner", "studio_cover", studioId, Png(1200, 800))).GetProperty("purpose").GetString().Should().Be("studio_cover");

        // 6. The avatar can be removed; the audit has the uploads.
        (await RawAsync(client, HttpMethod.Delete, $"{studioPath}/media?purpose=avatar&ownerId={nogaId}", Customer("noga"))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer("noga"))).GetProperty("avatarUrl").ValueKind.Should().Be(JsonValueKind.Null);
        var actions = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("action").GetString()).ToList();
        actions.Should().Contain(["media.uploaded", "media.removed", "staff_profile.updated", "session.note_updated"]);
    }

    [Fact]
    public async Task UploadTickets_AreCapped_PerMembership_AndHugePictures_AreRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, _, _) = await StudioAsync(client, ["noga"], capacity: 4);
        var nogaId = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer("noga"))).GetProperty("id").GetGuid();
        var ticket = new { purpose = "avatar", ownerId = nogaId, contentType = "image/png", bytes = 100 };

        // A picture over 12 MP is refused at finalize: decoding it could exhaust the function's memory.
        (await UploadRawAsync(client, studioPath, "noga", nogaId, Png(4000, 4000))).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // That ticket counts too: the 21st within the hour is refused.
        for (var i = 1; i < MediaService.UploadsPerHour; i++)
        {
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("noga"), ticket, HttpStatusCode.Created);
        }

        var limited = await RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("noga"), ticket);
        limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        limited.Headers.RetryAfter.Should().NotBeNull();

        // The cap is per membership: the owner still gets a ticket.
        var studioId = Guid.Parse(studioPath.Split('/')[^1]);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("owner"), new { purpose = "studio_cover", ownerId = studioId, contentType = "image/png", bytes = 100 }, HttpStatusCode.Created);
    }

    [Fact]
    public async Task TwoFinalizes_OfOneUpload_PointTheOwnerOnce()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, _, _) = await StudioAsync(client, ["noga"], capacity: 4);
        var nogaId = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/profile", Customer("noga"))).GetProperty("id").GetGuid();
        var file = Png(1200, 1200);
        var ticket = await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("noga"), new { purpose = "avatar", ownerId = nogaId, contentType = "image/png", bytes = file.Length }, HttpStatusCode.Created);
        var id = ticket.GetProperty("mediaId").GetGuid();
        store.Upload(MediaKeys.Incoming(StudioOf(studioPath), id), file);

        // Only one finalize points the owner at the picture (#345): the other is told the upload is finished.
        var finalizes = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads/{id}/finalize", Customer("noga"))));
        finalizes.Select(r => r.StatusCode).Should().BeEquivalentTo([HttpStatusCode.OK, HttpStatusCode.Conflict]);
        var loser = await finalizes.Single(r => r.StatusCode == HttpStatusCode.Conflict).Content.ReadAsStringAsync();
        JsonSerializer.Deserialize<JsonElement>(loser).GetProperty("code").GetString().Should().Be("media.not_pending");
        var uploads = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Count(e => e.GetProperty("action").GetString() == "media.uploaded");
        uploads.Should().Be(1);
        store.Keys.Should().Contain([MediaKeys.Large(StudioOf(studioPath), id), MediaKeys.Small(StudioOf(studioPath), id)]);
    }

    private static Guid StudioOf(string studioPath) => Guid.Parse(studioPath.Split('/')[^1]);

    private async Task<HttpResponseMessage> UploadRawAsync(HttpClient client, string studioPath, string who, Guid ownerId, byte[] file)
    {
        var ticket = await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer(who), new { purpose = "avatar", ownerId, contentType = "image/png", bytes = file.Length }, HttpStatusCode.Created);
        var id = ticket.GetProperty("mediaId").GetGuid();
        store.Upload(MediaKeys.Incoming(StudioOf(studioPath), id), file);
        return await RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads/{id}/finalize", Customer(who));
    }

    private async Task<JsonElement> UploadAsync(HttpClient client, string studioPath, string who, string purpose, Guid ownerId, byte[] file)
    {
        var ticket = await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer(who), new { purpose, ownerId, contentType = "image/png", bytes = file.Length }, HttpStatusCode.Created);
        var id = ticket.GetProperty("mediaId").GetGuid();
        ticket.GetProperty("uploadForm").GetProperty("fields").GetProperty("key").GetString().Should().Be(MediaKeys.Incoming(StudioOf(studioPath), id));
        store.Upload(MediaKeys.Incoming(StudioOf(studioPath), id), file);
        return await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads/{id}/finalize", Customer(who));
    }

    private static byte[] Png(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(new SKColor(0xbd, 0x99, 0x8d));
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
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
