using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Tempo.Api.DependencyInjection;
using Tempo.Contracts.Api.Common;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// The API's own Cognito access-token validation (ADR-0004 amendment): a
/// local signing key stands in for the user pool's JWKS, so every rule runs
/// without AWS.
/// </summary>
public sealed class MeEndpointTests : IDisposable
{
    private const string Issuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_TestPool";
    private const string AllowedClient = "allowed-client";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly RsaSecurityKey signingKey;
    private readonly WebApplicationFactory<Program> factory;

    public MeEndpointTests()
    {
        signingKey = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<CognitoOptions>(o =>
                {
                    o.Issuer = Issuer;
                    o.ClientIds = [AllowedClient];
                });
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o =>
                {
                    // Stand in for the user pool's /.well-known metadata and JWKS.
                    o.Authority = null;
                    o.Configuration = new OpenIdConnectConfiguration { Issuer = Issuer };
                    o.Configuration.SigningKeys.Add(signingKey);
                    o.TokenValidationParameters.ValidIssuer = Issuer;
                    o.TokenValidationParameters.IssuerSigningKey = signingKey;
                });
            }));
    }

    public void Dispose()
    {
        factory.Dispose();
        rsa.Dispose();
    }

    [Fact]
    public async Task Me_WithoutToken_Returns401()
    {
        var response = await factory.CreateClient().GetAsync("/api/v1/me");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Me_WithAccessTokenInTempoHeader_ReturnsCallerIdentity()
    {
        // Behind CloudFront OAC the Authorization header carries CloudFront's
        // SigV4 signature, so the client sends the token in X-Tempo-Authorization.
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        request.Headers.Add(CognitoAuthentication.TokenHeader, "Bearer " + Token());
        request.Headers.Authorization = new AuthenticationHeaderValue("AWS4-HMAC-SHA256", "Credential=cloudfront-signature");

        var response = await factory.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var me = await response.Content.ReadFromJsonAsync<MeResponse>();
        me!.Subject.Should().Be("user-123");
    }

    [Fact]
    public async Task Me_WithAccessTokenInAuthorizationHeader_ReturnsOk()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token());

        var response = await factory.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("id", AllowedClient, 10, "an ID token is not an access token")]
    [InlineData("access", "other-client", 10, "the token was issued to another app client")]
    [InlineData("access", AllowedClient, -10, "the token has expired")]
    public async Task Me_WithRejectedToken_Returns401(string tokenUse, string clientId, int expiresInMinutes, string because)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        request.Headers.Add(CognitoAuthentication.TokenHeader, "Bearer " + Token(tokenUse, clientId, expiresInMinutes));

        var response = await factory.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, because);
    }

    [Fact]
    public async Task Me_WithTokenFromAnotherIssuer_Returns401()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        request.Headers.Add(CognitoAuthentication.TokenHeader, "Bearer " + Token(issuer: "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_OtherPool"));

        var response = await factory.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private string Token(string tokenUse = "access", string clientId = AllowedClient, int expiresInMinutes = 10, string issuer = Issuer)
    {
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Subject = new ClaimsIdentity([new Claim("sub", "user-123"), new Claim("token_use", tokenUse), new Claim("client_id", clientId)]),
            NotBefore = now.AddMinutes(expiresInMinutes > 0 ? -1 : -30),
            IssuedAt = now.AddMinutes(expiresInMinutes > 0 ? -1 : -30),
            Expires = now.AddMinutes(expiresInMinutes),
            SigningCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256)
        });
    }
}
