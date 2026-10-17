using Amazon.CognitoIdentityProvider;
using Amazon.CognitoIdentityProvider.Model;
using Tempo.Platform.Modules.Identity.Application;

namespace Tempo.Api.Identity;

/// <summary>
/// Deletes a customer-pool user with Cognito AdminDeleteUser after the account is gone from the database
/// (docs/32 section 9). The API's role may call it on the customer pool only. A user already gone is success.
/// </summary>
public sealed class CognitoUserDeleter : ICognitoUserDeleter, IDisposable
{
    private readonly Lazy<AmazonCognitoIdentityProviderClient> client = new(() => new AmazonCognitoIdentityProviderClient());

    public async Task DeleteAsync(string issuer, string username, CancellationToken cancellationToken)
    {
        try
        {
            await client.Value.AdminDeleteUserAsync(
                new AdminDeleteUserRequest { UserPoolId = new Uri(issuer).AbsolutePath.Trim('/'), Username = username },
                cancellationToken);
        }
        catch (UserNotFoundException)
        {
            // Deleted by an earlier try.
        }
    }

    public void Dispose()
    {
        if (client.IsValueCreated)
        {
            client.Value.Dispose();
        }
    }
}
