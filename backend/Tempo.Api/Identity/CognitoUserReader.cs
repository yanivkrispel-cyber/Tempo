using Amazon.CognitoIdentityProvider;
using Amazon.CognitoIdentityProvider.Model;
using Tempo.Platform.Modules.Identity.Application;

namespace Tempo.Api.Identity;

/// <summary>
/// Reads a user's email and verification with Cognito AdminGetUser, because
/// access tokens carry no email (docs/26 section 2.3). The API's role may call
/// it on the customer pool only. The pool id is the issuer's last path segment.
/// </summary>
public sealed class CognitoUserReader : ICognitoUserReader, IDisposable
{
    private readonly Lazy<AmazonCognitoIdentityProviderClient> client = new(() => new AmazonCognitoIdentityProviderClient());

    public async Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken)
    {
        var userPoolId = new Uri(issuer).AbsolutePath.Trim('/');
        var response = await client.Value.AdminGetUserAsync(
            new AdminGetUserRequest { UserPoolId = userPoolId, Username = username },
            cancellationToken);

        var attributes = (response.UserAttributes ?? []).ToDictionary(a => a.Name, a => a.Value, StringComparer.Ordinal);
        var email = attributes.GetValueOrDefault("email")
            ?? throw new InvalidOperationException("The Cognito user has no email attribute.");
        var verified = string.Equals(attributes.GetValueOrDefault("email_verified"), "true", StringComparison.OrdinalIgnoreCase);

        return new CognitoUser(email, verified);
    }

    public void Dispose()
    {
        if (client.IsValueCreated)
        {
            client.Value.Dispose();
        }
    }
}
