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
/// The prices and offers pages and a full class's link (board #404 SL-3 to SL-5, SK2) through the real API host and a
/// migrated PostgreSQL 18: the owner lists products in an order, offers come first with a per-class price, an ended or
/// archived offer says `ended`, an unlisted one is 404, and a full class offers up to three others with room, the same
/// class type first. No person in any answer. Fictional people only.
/// </summary>
public sealed class PublicProductsFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task TheOwnerListsProducts_AndStrangersSeeOffersFirst_EndedOffers_AndAlternativesForAFullClass()
    {
        PublicRateLimitFilter.Reset();
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var (studioPath, slug, _) = await StudioAsync(client, "owner");
        var publicPath = $"/api/v1/public/studios/{slug}";
        async Task<Guid> ProductAsync(object body) =>
            (await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), body, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var ten = await ProductAsync(new { kind = "punch_card", name = "10 שיעורים", entries = 10, validDays = 180, priceAgorot = 70000 });
        var trial = await ProductAsync(new { kind = "punch_card", name = "3 שיעורי ניסיון", entries = 3, validDays = 35, priceAgorot = 9900 });
        var monthly = await ProductAsync(new { kind = "membership", name = "חופשי חודשי", validDays = 30, priceAgorot = 49000 });
        var hidden = await ProductAsync(new { kind = "punch_card", name = "פנימי", entries = 1, validDays = 7 });

        // 1. The owner lists three products; the console reads them back in the same order.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/public-page", Customer("owner"), new
        {
            enabled = true,
            openJoin = true,
            listedProducts = new object[]
            {
                new { productId = ten, newcomersOnly = false, publicUntil = (string?)null, blurb = (string?)null },
                new { productId = monthly, newcomersOnly = false, publicUntil = (string?)null, blurb = "כל השיעורים" },
                new { productId = trial, newcomersOnly = true, publicUntil = "2099-10-31", blurb = "  למצטרפות חדשות  " }
            }
        });
        var page = await SendAsync(client, HttpMethod.Get, $"{studioPath}/public-page", Customer("owner"));
        page.GetProperty("listedProducts").EnumerateArray().Select(p => p.GetProperty("productId").GetGuid()).Should().Equal(ten, monthly, trial);
        page.GetProperty("listedProducts")[2].GetProperty("blurb").GetString().Should().Be("למצטרפות חדשות");
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, listedProducts = new[] { new { productId = ten, newcomersOnly = false }, new { productId = ten, newcomersOnly = false } } }, "listedProducts.invalid");
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, listedProducts = new[] { new { productId = Guid.NewGuid(), newcomersOnly = false } } }, "listedProducts.invalid");
        await ProblemAsync(client, $"{studioPath}/public-page", new { enabled = true, openJoin = true, listedProducts = new[] { new { productId = ten, newcomersOnly = false, blurb = new string('א', 121) } } }, "listedProducts.invalid");

        // 2. Strangers: offers first, then the owner's order; the price per class for punch cards; nothing unlisted.
        var products = await client.GetAsync($"{publicPath}/products");
        products.Headers.CacheControl!.Public.Should().BeTrue();
        var items = (await products.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().ToList();
        items.Select(p => p.GetProperty("id").GetGuid()).Should().Equal(trial, ten, monthly);
        items[0].GetProperty("pricePerClassAgorot").GetInt32().Should().Be(3300);
        items[1].GetProperty("pricePerClassAgorot").GetInt32().Should().Be(7000);
        items[2].GetProperty("pricePerClassAgorot").ValueKind.Should().Be(JsonValueKind.Null, "a membership has no per-class price");
        items[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            "id", "name", "kind", "priceAgorot", "entries", "pricePerClassAgorot", "validDays", "newcomersOnly", "publicUntil", "blurb");

        // 3. One offer: listed and live; unlisted is 404; past its last day or archived it is `ended`.
        var offer = await SendAsync(client, HttpMethod.Get, $"{publicPath}/products/{trial}", null);
        offer.GetProperty("ended").GetBoolean().Should().BeFalse();
        offer.GetProperty("product").GetProperty("newcomersOnly").GetBoolean().Should().BeTrue();
        (await client.GetAsync($"{publicPath}/products/{hidden}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET public_until = current_date - 2 WHERE id = $1", trial);
        var ended = await SendAsync(client, HttpMethod.Get, $"{publicPath}/products/{trial}", null);
        ended.GetProperty("ended").GetBoolean().Should().BeTrue();
        ended.GetProperty("product").ValueKind.Should().Be(JsonValueKind.Null);
        (await SendAsync(client, HttpMethod.Get, $"{publicPath}/products", null)).GetProperty("items").EnumerateArray().Select(p => p.GetProperty("id").GetGuid())
            .Should().Equal(ten, monthly);
        await db.AsMasterAsync("UPDATE scheduling.pass_products SET status = 'archived' WHERE id = $1", monthly);
        (await SendAsync(client, HttpMethod.Get, $"{publicPath}/products/{monthly}", null)).GetProperty("ended").GetBoolean().Should().BeTrue();

        // 4. A full class's link offers up to three upcoming classes with room, the same class type first (SL-3).
        var pilates = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "פילאטיס", category = "pilates", color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var yoga = (await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "יוגה", category = "yoga", color = "sage", defaultMinutes = 60 }, HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var full = await SessionAsync(client, studioPath, pilates, 2, "18:00", 1);
        var yogaSoon = await SessionAsync(client, studioPath, yoga, 2, "19:00", 8);
        var pilatesLater = await SessionAsync(client, studioPath, pilates, 4, "18:00", 8);
        await SessionAsync(client, studioPath, pilates, 20, "18:00", 8);
        await db.AsMasterAsync("UPDATE scheduling.sessions SET booked_count = capacity WHERE id = $1", full);
        var fullPage = await SendAsync(client, HttpMethod.Get, $"{publicPath}/sessions/{full}", null);
        fullPage.GetProperty("availability").GetString().Should().Be("full");
        fullPage.GetProperty("past").GetBoolean().Should().BeFalse();
        var alternatives = fullPage.GetProperty("alternatives").EnumerateArray().ToList();
        alternatives.Select(a => a.GetProperty("id").GetGuid()).Should().Equal([pilatesLater, yogaSoon], "the same class type first, nothing past 14 days");
        alternatives[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("id", "startsAt", "minutes", "className", "instructorName", "availability", "spotsLeft");
        (await SendAsync(client, HttpMethod.Get, $"{publicPath}/sessions/{yogaSoon}", null)).GetProperty("alternatives").GetArrayLength().Should().Be(0, "a class with room needs none");
    }

    private async Task ProblemAsync(HttpClient client, string path, object body, string code)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = JsonContent.Create(body, body.GetType()) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Customer("owner"));
        var response = await client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().Should().Be(code);
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
