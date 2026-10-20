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
using SkiaSharp;
using Tempo.Api.DependencyInjection;
using Tempo.IntegrationTests.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Media;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// The studio's brand (docs/35 section 2, WL1) through the real API host, a migrated PostgreSQL 18 and an in-memory
/// picture store: the defaults, a change with If-Match, who may change it, the logo and the icon through the picture
/// flow, the icon's PNG sizes drawn on the brand's ground and drawn again when the accent changes, and the audit with
/// field names only. Fictional people only.
/// </summary>
public sealed class BrandFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheBrand_DefaultsChangesPicturesAndAudit_EndToEnd()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, studioId) = await StudioAsync(client, "סטודיו נשימה ותנועה");
        await JoinByInvitationAsync(client, studioPath, "noga", "client");
        await JoinByInvitationAsync(client, studioPath, "dana", "staff");

        // 1. Before anything is saved: the display name's first word, sage, paper, version 0. A member reads it.
        var defaults = await SendAsync(client, HttpMethod.Get, $"{studioPath}/brand", Customer("noga"));
        defaults.GetProperty("appName").GetString().Should().Be("סטודיו");
        defaults.GetProperty("accentId").GetString().Should().Be("sage");
        defaults.GetProperty("iconBackground").GetString().Should().Be("paper");
        defaults.GetProperty("customized").GetBoolean().Should().BeFalse();
        defaults.GetProperty("version").GetString().Should().Be("0");
        defaults.GetProperty("iconUrl").ValueKind.Should().Be(JsonValueKind.Null);

        // 2. Only owners and admins change it; anything outside the eight accents or 12 characters is refused.
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/brand", Customer("noga"), Input("נשימה", "ocean", "paper"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/brand", Customer("dana"), Input("נשימה", "ocean", "paper"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await ProblemAsync(client, Input("נשימה", "#ff0000", "paper"), HttpStatusCode.BadRequest, "accentId.invalid");
        await ProblemAsync(client, Input("סטודיו נשימה ות", "ocean", "paper"), HttpStatusCode.BadRequest, "appName.invalid");
        await ProblemAsync(client, Input("נשימה", "ocean", "white"), HttpStatusCode.BadRequest, "iconBackground.invalid");

        var saved = await SendAsync(client, HttpMethod.Put, $"{studioPath}/brand", Customer("owner"), Input(" נשימה ", "ocean", "paper"), ifMatch: "0");
        saved.GetProperty("appName").GetString().Should().Be("נשימה");
        saved.GetProperty("accentId").GetString().Should().Be("ocean");
        saved.GetProperty("customized").GetBoolean().Should().BeTrue();
        saved.GetProperty("version").GetString().Should().Be("1");
        (await ProblemAsync(client, Input("נשימה", "plum", "paper"), HttpStatusCode.Conflict, "concurrency.conflict", ifMatch: "0")).Should().NotBeNull();

        // Saving the same values again changes nothing.
        (await SendAsync(client, HttpMethod.Put, $"{studioPath}/brand", Customer("owner"), Input("נשימה", "ocean", "paper"))).GetProperty("version").GetString().Should().Be("1");

        // 3. A logo through the picture flow; the studio is its owner, and a member can't set it.
        (await RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("noga"), new { purpose = "studio_logo", ownerId = studioId, contentType = "image/png", bytes = 100 }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var logo = await UploadAsync(client, studioPath, studioId, "studio_logo", Png(900, 300, SKColors.White));
        logo.GetProperty("purpose").GetString().Should().Be("studio_logo");
        var withLogo = await SendAsync(client, HttpMethod.Get, $"{studioPath}/brand", Customer("noga"));
        withLogo.GetProperty("logoUrl").GetString().Should().Contain(MediaKeys.Large(studioId, logo.GetProperty("id").GetGuid()));
        withLogo.GetProperty("version").GetString().Should().Be("2", "a new logo bumps the version");

        // 4. An icon under 512 x 512 is refused; one at 512 gets its four PNGs on paper.
        var small = await UploadRawAsync(client, studioPath, studioId, "studio_icon", Png(400, 400, SKColors.White));
        small.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await small.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be("media.icon_too_small");

        var icon = (await UploadAsync(client, studioPath, studioId, "studio_icon", Png(600, 600, SKColors.White))).GetProperty("id").GetGuid();
        foreach (var size in StudioIcons.Sizes)
        {
            store.Keys.Should().Contain(MediaKeys.Icon(studioId, icon, size.Name));
        }

        (await CornerAsync(studioId, icon)).Should().Be(SKColor.Parse("#fbfaf8"), "the icon starts on paper");
        var withIcon = await SendAsync(client, HttpMethod.Get, $"{studioPath}/brand", Customer("owner"));
        withIcon.GetProperty("iconUrl").GetString().Should().Contain(MediaKeys.Icon(studioId, icon, "512"));
        withIcon.GetProperty("version").GetString().Should().Be("3");

        // 5. The icon on the accent: its PNGs are drawn again before the new version shows.
        var onAccent = await SendAsync(client, HttpMethod.Put, $"{studioPath}/brand", Customer("owner"), Input("נשימה", "plum", "accent"), ifMatch: "3");
        onAccent.GetProperty("version").GetString().Should().Be("4");
        (await CornerAsync(studioId, icon)).Should().Be(SKColor.Parse("#7a607c"));

        // 6. A new icon replaces the old one with all of its objects; removing it clears the brand's icon.
        var second = (await UploadAsync(client, studioPath, studioId, "studio_icon", Png(512, 512, SKColors.White))).GetProperty("id").GetGuid();
        store.Keys.Should().NotContain(MediaKeys.Icon(studioId, icon, "192")).And.Contain(MediaKeys.Icon(studioId, second, "192"));
        (await CornerAsync(studioId, second)).Should().Be(SKColor.Parse("#7a607c"), "a new icon is drawn on the brand's ground");
        (await RawAsync(client, HttpMethod.Delete, $"{studioPath}/media?purpose=studio_icon&ownerId={studioId}", Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        store.Keys.Should().NotContain(MediaKeys.Icon(studioId, second, "512"));
        var removed = await SendAsync(client, HttpMethod.Get, $"{studioPath}/brand", Customer("owner"));
        removed.GetProperty("iconUrl").ValueKind.Should().Be(JsonValueKind.Null);
        removed.GetProperty("version").GetString().Should().Be("6");

        // 7. The audit names the changed fields, never their values.
        var audit = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/audit-events?limit=100", Customer("owner"))).GetProperty("items").EnumerateArray()
            .Where(e => e.GetProperty("action").GetString() == "brand.updated")
            .Select(e => e.GetRawText())
            .ToList();
        audit.Should().HaveCount(2);
        audit.Should().AllSatisfy(row => row.Should().NotContain("נשימה").And.NotContain("plum\"").And.Contain("fields"));
    }

    private async Task<SKColor> CornerAsync(Guid studioId, Guid iconId)
    {
        var png = await store.ReadAsync(MediaKeys.Icon(studioId, iconId, "512"), int.MaxValue, CancellationToken.None);
        using var bitmap = SKBitmap.Decode(png);
        return bitmap.GetPixel(2, 2);
    }

    private static object Input(string appName, string accentId, string iconBackground) => new { appName, accentId, iconBackground };

    private async Task<JsonElement> ProblemAsync(HttpClient client, object body, HttpStatusCode status, string code, string? ifMatch = null)
    {
        var studios = (await SendAsync(client, HttpMethod.Get, "/api/v1/me", Customer("owner"))).GetProperty("memberships")[0].GetProperty("organization").GetProperty("id").GetGuid();
        var response = await RawAsync(client, HttpMethod.Put, $"/api/v1/organizations/{studios}/brand", Customer("owner"), body, ifMatch);
        response.StatusCode.Should().Be(status);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("code").GetString().Should().Be(code);
        return problem;
    }

    private async Task<HttpResponseMessage> UploadRawAsync(HttpClient client, string studioPath, Guid studioId, string purpose, byte[] file)
    {
        var ticket = await SendAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads", Customer("owner"), new { purpose, ownerId = studioId, contentType = "image/png", bytes = file.Length }, HttpStatusCode.Created);
        var id = ticket.GetProperty("mediaId").GetGuid();
        store.Upload(MediaKeys.Incoming(studioId, id), file);
        return await RawAsync(client, HttpMethod.Post, $"{studioPath}/media/uploads/{id}/finalize", Customer("owner"));
    }

    private async Task<JsonElement> UploadAsync(HttpClient client, string studioPath, Guid studioId, string purpose, byte[] file)
    {
        var response = await UploadRawAsync(client, studioPath, studioId, purpose, file);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return JsonSerializer.Deserialize<JsonElement>(text);
    }

    private static byte[] Png(int width, int height, SKColor color)
    {
        using var bitmap = new SKBitmap(width, height);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(color);
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
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
