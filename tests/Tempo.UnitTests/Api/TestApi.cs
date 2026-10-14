using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using NSubstitute;
using Tempo.Api.DependencyInjection;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.UnitTests.Api;

/// <summary>
/// The API with both user pools stood in by one local signing key, the
/// account and membership directories replaced by substitutes, and optional
/// extra endpoints for a test.
/// </summary>
public sealed class TestApi : IDisposable
{
    public const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    public const string OperatorIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Operators";
    public const string CustomerClient = "customer-client";
    public const string OperatorClient = "operator-client";

    private readonly RSA rsa = RSA.Create(2048);
    private readonly RsaSecurityKey signingKey;
    private readonly WebApplicationFactory<Program> factory;

    public TestApi(Action<IEndpointRouteBuilder>? map = null)
    {
        signingKey = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                Pool(services, CognitoAuthentication.CustomerScheme, CustomerIssuer, CustomerClient);
                Pool(services, CognitoAuthentication.OperatorScheme, OperatorIssuer, OperatorClient);
                services.AddSingleton(Accounts);
                services.AddSingleton(Memberships);
                services.AddSingleton(AccountService);
                services.AddSingleton(Organizations);
                services.AddSingleton(Members);
                services.AddSingleton(Invitations);
                services.AddSingleton(JoinLinks);
                if (map is not null)
                {
                    services.AddSingleton<IEndpointModule>(new DelegateModule(map));
                }
            }));
    }

    public IAccountDirectory Accounts { get; } = Substitute.For<IAccountDirectory>();

    public IMembershipDirectory Memberships { get; } = Substitute.For<IMembershipDirectory>();

    public IAccountService AccountService { get; } = Substitute.For<IAccountService>();

    public IOrganizationService Organizations { get; } = Substitute.For<IOrganizationService>();

    public IMemberService Members { get; } = Substitute.For<IMemberService>();

    public IInvitationService Invitations { get; } = Substitute.For<IInvitationService>();

    public IJoinLinkService JoinLinks { get; } = Substitute.For<IJoinLinkService>();

    public HttpClient CreateClient() => factory.CreateClient();

    public async Task<HttpResponseMessage> GetAsync(string path, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await factory.CreateClient().SendAsync(request);
    }

    public string CustomerToken(string subject = "user-123") => Token(CustomerIssuer, CustomerClient, subject);

    public string OperatorToken(string subject = "operator-1") => Token(OperatorIssuer, OperatorClient, subject);

    public string Token(
        string issuer,
        string clientId,
        string subject = "user-123",
        string tokenUse = "access",
        int expiresInMinutes = 10,
        params Claim[] extraClaims)
    {
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Subject = new ClaimsIdentity([new Claim("sub", subject), new Claim("token_use", tokenUse), new Claim("client_id", clientId), .. extraClaims]),
            NotBefore = now.AddMinutes(expiresInMinutes > 0 ? -1 : -30),
            IssuedAt = now.AddMinutes(expiresInMinutes > 0 ? -1 : -30),
            Expires = now.AddMinutes(expiresInMinutes),
            SigningCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256)
        });
    }

    public void Dispose()
    {
        factory.Dispose();
        rsa.Dispose();
    }

    private void Pool(IServiceCollection services, string scheme, string issuer, string clientId)
    {
        services.PostConfigure<CognitoOptions>(scheme, o =>
        {
            o.Issuer = issuer;
            o.ClientIds = [clientId];
        });
        services.PostConfigure<JwtBearerOptions>(scheme, o =>
        {
            // Stand in for the user pool's /.well-known metadata and JWKS.
            o.Authority = null;
            o.Configuration = new OpenIdConnectConfiguration { Issuer = issuer };
            o.Configuration.SigningKeys.Add(signingKey);
            o.TokenValidationParameters.ValidIssuer = issuer;
            o.TokenValidationParameters.IssuerSigningKey = signingKey;
        });
    }

    private sealed class DelegateModule(Action<IEndpointRouteBuilder> map) : IEndpointModule
    {
        public void Map(IEndpointRouteBuilder endpoints) => map(endpoints);
    }
}
