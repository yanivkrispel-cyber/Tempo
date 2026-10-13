using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Tempo.Api.DependencyInjection;

/// <summary>Cognito settings for validating access tokens in the API.</summary>
public sealed class CognitoOptions
{
    /// <summary>The user pool issuer, https://cognito-idp.{region}.amazonaws.com/{userPoolId}. From COGNITO_ISSUER.</summary>
    public string? Issuer { get; set; }

    /// <summary>App clients whose access tokens the API accepts. From COGNITO_CLIENT_IDS, comma-separated.</summary>
    public IReadOnlyCollection<string> ClientIds { get; set; } = [];
}

/// <summary>
/// Validates Cognito access tokens in the API itself (ADR-0004 amendment).
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

    public static IServiceCollection AddCognitoAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<CognitoOptions>().Configure(options =>
        {
            options.Issuer = configuration["COGNITO_ISSUER"];
            options.ClientIds = (configuration["COGNITO_CLIENT_IDS"] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        });

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<CognitoOptions>>((jwt, cognito) => Configure(jwt, cognito.Value));
        services.AddAuthorization();

        return services;
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
                var options = context.HttpContext.RequestServices.GetRequiredService<IOptions<CognitoOptions>>().Value;
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
            }
        };
    }
}
