using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Api.Tenancy;

/// <summary>
/// Step-up for privileged actions (docs/27 section 3.6, A-3). Cognito has no
/// built-in step-up, so the API checks how recent the sign-in is: the access
/// token's `auth_time` must be at most ten minutes old, otherwise 401
/// `auth.step_up_required` and the app sends the user through sign-in again.
/// With MFA on, sign-in includes it, so this means "signed in with MFA lately".
/// </summary>
public static class StepUp
{
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    public const string Code = "auth.step_up_required";

    /// <summary>Throws 401 `auth.step_up_required` unless the caller signed in within <see cref="Window"/>.</summary>
    public static void Require(HttpContext httpContext, TimeProvider clock)
    {
        if (!IsRecent(httpContext, clock))
        {
            throw new DomainRuleViolationException(ViolationKind.Unauthorized, Code, "Sign in again to do this.");
        }
    }

    public static bool IsRecent(HttpContext httpContext, TimeProvider clock)
    {
        var claim = httpContext.User.FindFirst("auth_time")?.Value;
        if (!long.TryParse(claim, NumberStyles.Integer, CultureInfo.InvariantCulture, out var seconds))
        {
            return false;
        }

        var age = clock.GetUtcNow() - DateTimeOffset.FromUnixTimeSeconds(seconds);
        return age <= Window && age >= -TimeSpan.FromMinutes(5);
    }
}
