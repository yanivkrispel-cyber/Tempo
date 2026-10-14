using Tempo.Api.ErrorHandling;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Api.Tenancy;

/// <summary>
/// The internal account behind a validated customer token: issuer plus
/// `sub` (docs/26 section 2.3). Shared by the tenant filter and the account
/// routes.
/// </summary>
public static class CallerAccount
{
    /// <summary>
    /// The caller's active account, or the problem to answer instead:
    /// 404 `account.not_provisioned` before the first `POST /api/v1/session`,
    /// 403 `account.disabled` for a disabled account.
    /// </summary>
    public static async Task<(AccountSnapshot? Account, IResult? Problem)> ResolveAsync(HttpContext httpContext, IAccountDirectory accounts)
    {
        var issuer = httpContext.User.FindFirst("iss")?.Value;
        var subject = httpContext.User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(issuer) || string.IsNullOrEmpty(subject))
        {
            return (null, Problems.Result(httpContext, StatusCodes.Status401Unauthorized, "auth.unauthorized", "Sign in again."));
        }

        var account = await accounts.FindByExternalIdentityAsync(issuer, subject, httpContext.RequestAborted);
        if (account is null)
        {
            return (null, Problems.Result(httpContext, StatusCodes.Status404NotFound, "account.not_provisioned", "Start a session first."));
        }

        if (account.Status == AccountStatus.Disabled)
        {
            return (null, Problems.Result(httpContext, StatusCodes.Status403Forbidden, "account.disabled", "This account is disabled."));
        }

        return (account, null);
    }
}
