using System.Globalization;
using Tempo.Api.ErrorHandling;
using Tempo.Api.Middleware;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Account;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The account routes of docs/26 section 8.1 that need no studio:
/// POST /api/v1/session, GET /api/v1/me and PATCH /api/v1/me.
/// </summary>
public static class AccountEndpoints
{
    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var account = endpoints.MapAccountGroup();

        account.MapPost("/session", StartSessionAsync)
            .WithName("startSession")
            .Produces<MeResponse>();

        account.MapGet("/me", GetMeAsync)
            .WithName("getMe")
            .Produces<MeResponse>();

        account.MapPatch("/me", UpdateMeAsync)
            .WithName("updateMe")
            .Produces<MeResponse>();

        return endpoints;
    }

    private static async Task<IResult> StartSessionAsync(HttpContext httpContext, IAccountService accounts, IMembershipDirectory memberships)
    {
        var signIn = SignInOf(httpContext);
        if (signIn is null)
        {
            return Unauthorized(httpContext);
        }

        var account = await accounts.StartSessionAsync(signIn, httpContext.RequestAborted);
        return Results.Ok(await MeAsync(account, memberships, httpContext.RequestAborted));
    }

    /// <summary>The one route a disabled account may still call (docs/26 section 2.4).</summary>
    private static async Task<IResult> GetMeAsync(HttpContext httpContext, IAccountService accounts, IMembershipDirectory memberships)
    {
        var signIn = SignInOf(httpContext);
        if (signIn is null)
        {
            return Unauthorized(httpContext);
        }

        var account = await accounts.FindAsync(signIn.Issuer, signIn.Subject, httpContext.RequestAborted);
        return account is null
            ? Problems.Result(httpContext, StatusCodes.Status404NotFound, "account.not_provisioned", "Start a session first.")
            : Results.Ok(await MeAsync(account, memberships, httpContext.RequestAborted));
    }

    private static async Task<IResult> UpdateMeAsync(
        HttpContext httpContext,
        UpdateMeRequest request,
        IAccountDirectory directory,
        IAccountService accounts,
        IMembershipDirectory memberships)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, directory);
        if (caller is null)
        {
            return problem!;
        }

        var account = await accounts.UpdateAsync(caller.UserAccountId, request.DisplayName, request.Locale, httpContext.RequestAborted);
        return Results.Ok(await MeAsync(account, memberships, httpContext.RequestAborted));
    }

    private static async Task<MeResponse> MeAsync(AccountView account, IMembershipDirectory memberships, CancellationToken cancellationToken)
    {
        var studios = await memberships.ListForAccountAsync(account.Id, cancellationToken);
        return new MeResponse(
            account.Id,
            account.Email,
            account.EmailVerified,
            account.DisplayName,
            account.Locale,
            StoredValue.Of(account.Status),
            [.. studios.Select(m => new MyMembershipResponse(
                m.MembershipId,
                StoredValue.Of(m.Role),
                StoredValue.Of(m.Status),
                new MyOrganizationResponse(m.OrganizationId, m.Slug, m.DisplayName, StoredValue.Of(m.OrganizationStatus))))]);
    }

    /// <summary>
    /// The sign-in behind a validated customer access token. Cognito access
    /// tokens carry `username` (what AdminGetUser takes) and `auth_time`.
    /// </summary>
    private static SignIn? SignInOf(HttpContext httpContext)
    {
        var user = httpContext.User;
        var issuer = user.FindFirst("iss")?.Value;
        var subject = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(issuer) || string.IsNullOrEmpty(subject))
        {
            return null;
        }

        DateTimeOffset? authTime = long.TryParse(user.FindFirst("auth_time")?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : null;

        return new SignIn(
            issuer,
            subject,
            user.FindFirst("username")?.Value ?? subject,
            authTime,
            httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier);
    }

    private static IResult Unauthorized(HttpContext httpContext) =>
        Problems.Result(httpContext, StatusCodes.Status401Unauthorized, "auth.unauthorized", "Sign in again.");
}
