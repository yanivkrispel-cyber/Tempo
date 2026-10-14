using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Tempo.Api.ErrorHandling;

namespace Tempo.Api.DependencyInjection;

/// <summary>Cognito settings for validating one user pool's access tokens in the API.</summary>
public sealed class CognitoOptions
{
    /// <summary>The user pool issuer, https://cognito-idp.{region}.amazonaws.com/{userPoolId}.</summary>
    public string? Issuer { get; set; }

    /// <summary>App clients of that pool whose access tokens the API accepts.</summary>
    public IReadOnlyCollection<string> ClientIds { get; set; } = [];
}

/// <summary>
/// Validates Cognito access tokens in the API itself (ADR-0004 amendment),
/// with one JWT bearer scheme per user pool (ADR-0023, docs/26 section 2.2):
/// <see cref="CustomerScheme"/> for studio owners, staff and clients, from
/// COGNITO_ISSUER and COGNITO_CLIENT_IDS, and <see cref="OperatorScheme"/> for
/// the Tempo team on `/api/v1/platform/*`, from COGNITO_OPERATOR_ISSUER and
/// COGNITO_OPERATOR_CLIENT_IDS. A token from the other pool fails the issuer
/// check, so it gets 401.
///
/// Behind CloudFront Origin Access Control the viewer's Authorization header
/// is replaced by CloudFront's own SigV4 signature, so the token travels in
/// <see cref="TokenHeader"/>; the standard Authorization header is still
/// accepted for local runs and while API Gateway fronts the API. Cognito
/// access tokens carry <c>client_id</c> instead of <c>aud</c>, so the client
/// and <c>token_use</c> are checked after the signature, issuer and lifetime.
/// </summary>
public static class CognitoAuthentication
{
    public const string TokenHeader = "X-Tempo-Authorization";

    public const string CustomerScheme = "customer";
    public const string OperatorScheme = "operator";

    /// <summary>The policy for `/api/v1/platform/*`. Every other route uses the default (customer) policy.</summary>
    public const string OperatorPolicy = "operator";

    public static IServiceCollection AddCognitoAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        AddPool(services, configuration, CustomerScheme, "COGNITO_ISSUER", "COGNITO_CLIENT_IDS");
        AddPool(services, configuration, OperatorScheme, "COGNITO_OPERATOR_ISSUER", "COGNITO_OPERATOR_CLIENT_IDS");

        services.AddAuthentication(CustomerScheme)
            .AddJwtBearer(CustomerScheme)
            .AddJwtBearer(OperatorScheme);

        services.AddAuthorizationBuilder()
            .SetDefaultPolicy(new AuthorizationPolicyBuilder(CustomerScheme).RequireAuthenticatedUser().Build())
            .AddPolicy(OperatorPolicy, policy => policy.AddAuthenticationSchemes(OperatorScheme).RequireAuthenticatedUser());

        return services;
    }

    private static void AddPool(IServiceCollection services, IConfiguration configuration, string scheme, string issuerKey, string clientIdsKey)
    {
        services.AddOptions<CognitoOptions>(scheme).Configure(options =>
        {
            options.Issuer = configuration[issuerKey];
            options.ClientIds = (configuration[clientIdsKey] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        });

        services.AddOptions<JwtBearerOptions>(scheme)
            .Configure<IOptionsMonitor<CognitoOptions>>((jwt, cognito) => Configure(jwt, cognito.Get(scheme)));
    }

    private static void Configure(JwtBearerOptions jwt, CognitoOptions cognito)
    {
        // Signing keys come from {issuer}/.well-known/jwks.json. Without an
        // issuer (a local run with no user pool) every token is rejected.
        jwt.Authority = cognito.Issuer;
        jwt.MapInboundClaims = false;
        jwt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = cognito.Issuer,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        jwt.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var header = context.Request.Headers[TokenHeader].ToString();
                if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                {
                    context.Token = header["Bearer ".Length..].Trim();
                }

                return Task.CompletedTask;
            },
            OnTokenValidated = context =>
            {
                var options = context.HttpContext.RequestServices
                    .GetRequiredService<IOptionsMonitor<CognitoOptions>>()
                    .Get(context.Scheme.Name);
                var tokenUse = context.Principal?.FindFirst("token_use")?.Value;
                var clientId = context.Principal?.FindFirst("client_id")?.Value;

                if (!string.Equals(tokenUse, "access", StringComparison.Ordinal))
                {
                    context.Fail("Only Cognito access tokens are accepted.");
                }
                else if (clientId is null || !options.ClientIds.Contains(clientId, StringComparer.Ordinal))
                {
                    context.Fail("The token was issued to a client this API does not accept.");
                }

                return Task.CompletedTask;
            },
            OnChallenge = async context =>
            {
                // The contract answers 401 with Problem Details as well.
                context.HandleResponse();
                await Problems.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized, "auth.unauthorized", "Sign in again.");
            }
        };
    }
}
