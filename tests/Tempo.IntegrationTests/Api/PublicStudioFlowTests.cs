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
/// A studio's own installable app (docs/35 section 5, WL4) through the real API host and a migrated PostgreSQL 18:
/// the manifest with absolute `id`, `start_url` and `scope` on the members app, the initials icon before any brand,
/// the studio's own icon PNGs after it, and 404 for an unknown or suspended studio. No sign-in anywhere public.
/// </summary>
public sealed class PublicStudioFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string MembersApp = "https://members.test";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly InMemoryMediaStore store = new();

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheStudiosManifestAndIcons_AreServedToAnyone_AndOnlyForAnActiveStudio()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, studioId, slug) = await StudioAsync(client, "סטודיו נשימה ותנועה");
        var publicPath = $"/api/v1/public/studios/{slug}";

        // 1. No sign-in. Before any brand: the default name, sage, and the studio's initials as the icon.
        var response = await client.GetAsync($"{publicPath}/manifest.webmanifest");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/manifest+json");
        response.Headers.CacheControl!.ToString().Should().Contain("max-age=300");
        var manifest = JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
        var home = $"{MembersApp}/s/{slug}/";
        manifest.GetProperty("id").GetString().Should().Be(home, "the members app's origin, not the API's (docs/35 section 5)");
        manifest.GetProperty("start_url").GetString().Should().Be(home);
        manifest.GetProperty("scope").GetString().Should().Be(home);
        manifest.GetProperty("name").GetString().Should().Be("סטודיו נשימה ותנועה");
        manifest.GetProperty("short_name").GetString().Should().Be("סטודיו");
        manifest.GetProperty("theme_color").GetString().Should().Be("#56735b");
        manifest.GetProperty("display").GetString().Should().Be("standalone");
        manifest.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["id", "name", "short_name", "lang", "dir", "start_url", "scope", "display", "orientation", "background_color", "theme_color", "icons"],
            "a public answer carries the studio's face only");
        var icons = manifest.GetProperty("icons").EnumerateArray()
            .Select(i => $"{i.GetProperty("src").GetString()} {i.GetProperty("sizes").GetString()} {i.GetProperty("purpose").GetString()}");
        icons.Should().Equal("icons/192?v=0 192x192 any", "icons/512?v=0 512x512 any", "icons/512-maskable?v=0 512x512 maskable");

        var initials = await client.GetAsync($"{publicPath}/icons/192?v=0");
        initials.StatusCode.Should().Be(HttpStatusCode.OK);
        initials.Content.Headers.ContentType!.MediaType.Should().Be("image/png");
        initials.Headers.CacheControl!.ToString().Should().Contain("immutable");
        using (var bitmap = SKBitmap.Decode(await initials.Content.ReadAsByteArrayAsync()))
        {
            bitmap.Width.Should().Be(192);
            bitmap.GetPixel(1, 1).Should().Be(SKColor.Parse("#56735b"));
            Enumerable.Range(40, 112).Any(x => bitmap.GetPixel(x, 96) == SKColors.White).Should().BeTrue("the initials are drawn in white");
        }

        (await client.GetAsync($"{publicPath}/icons/64")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 2. A brand with an icon: the manifest names its version and the icon is the studio's own PNG.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/brand", Customer("owner"), Input("נשימה", "ocean", "accent"));
        var icon = await UploadAsync(client, studioPath, studioId, "studio_icon", Png(600, 600, SKColors.White));
        manifest = JsonSerializer.Deserialize<JsonElement>(await client.GetStringAsync($"{publicPath}/manifest.webmanifest"));
        manifest.GetProperty("short_name").GetString().Should().Be("נשימה");
        manifest.GetProperty("theme_color").GetString().Should().Be("#4a7088");
        manifest.GetProperty("icons")[2].GetProperty("src").GetString().Should().Be("icons/512-maskable?v=2");
        var own = await client.GetByteArrayAsync($"{publicPath}/icons/512-maskable?v=2");
        own.Should().Equal(await store.ReadAsync(MediaKeys.Icon(studioId, icon.GetProperty("id").GetGuid(), "512-maskable"), int.MaxValue, CancellationToken.None));

        // 3. An unknown slug and a suspended studio are both 404 studio.not_found.
        var unknown = await client.GetAsync("/api/v1/public/studios/no-such-studio/manifest.webmanifest");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await unknown.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be("studio.not_found");
        await db.AsMasterAsync("UPDATE organizations.organizations SET status = 'suspended' WHERE id = $1", studioId);
        (await client.GetAsync($"{publicPath}/icons/192?v=2")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.GetAsync($"{publicPath}/manifest.webmanifest")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<(string StudioPath, Guid StudioId, string Slug)> StudioAsync(HttpClient client, string displayName)
    {
        var slug = $"studio-{Guid.NewGuid():N}"[..20];
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName, slug }, HttpStatusCode.Created);
        var id = studio.GetProperty("id").GetGuid();
        return ($"/api/v1/organizations/{id}", id, slug);
    }

    private static object Input(string appName, string accentId, string iconBackground) => new { appName, accentId, iconBackground };

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
