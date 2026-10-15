using Tempo.Api.ErrorHandling;
using Tempo.Api.Middleware;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Api.Tenancy;

/// <summary>
/// Marks a tenant route that still answers while the studio is suspended
/// (docs/26 section 3.3: reads of the organization itself).
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AllowWhenOrganizationSuspendedAttribute : Attribute;

/// <summary>
/// Resolves the tenant of every `/api/v1/organizations/{organizationId}`
/// route from the route only (docs/26 section 6):
/// <list type="number">
///   <item>the caller's account, from the token's issuer and subject;</item>
///   <item>the caller's membership in that studio. None, or a removed one, is
///   404 `organization.not_found`, the same as a studio that does not exist,
///   so ids cannot be probed;</item>
///   <item>a suspended membership is 403 `membership.suspended`, a suspended
///   studio 403 `organization.suspended`;</item>
///   <item>the caller's permissions (the union of their live role
///   assignments) against the route's <see cref="RequirePermissionAttribute"/>:
///   missing, 403 `permission.denied` (docs/27 section 3.4);</item>
///   <item>an immutable <see cref="TenantContext"/> for the endpoint.</item>
/// </list>
/// </summary>
/// <summary>
/// `TEMPO_REQUIRE_OWNER_MFA` (docs/27 section 3.6, A-5): when true, owner and
/// admin memberships need an account with MFA set up. Off by default.
/// </summary>
public sealed record OwnerMfaPolicy(bool Required)
{
    public static OwnerMfaPolicy From(IConfiguration configuration) =>
        new(bool.TryParse(configuration["TEMPO_REQUIRE_OWNER_MFA"], out var required) && required);
}

public sealed class TenantRouteFilter(IAccountDirectory accounts, IMembershipDirectory memberships, OwnerMfaPolicy mfaPolicy) : IEndpointFilter
{
    public const string RouteValue = "organizationId";

    private const string ItemKey = "Tempo.TenantContext";

    public static TenantContext Current(HttpContext httpContext) =>
        httpContext.Items[ItemKey] as TenantContext
        ?? throw new InvalidOperationException("No tenant context: the endpoint is not in the tenant route group.");

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;
        var cancellationToken = httpContext.RequestAborted;

        var (account, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (account is null)
        {
            return problem;
        }

        if (!Guid.TryParse(httpContext.GetRouteValue(RouteValue)?.ToString(), out var organizationId))
        {
            return NotFound(httpContext);
        }

        var membership = await memberships.FindAsync(account.UserAccountId, organizationId, cancellationToken);
        if (membership is null || membership.Status is MembershipStatus.Removed or MembershipStatus.Invited)
        {
            return NotFound(httpContext);
        }

        if (membership.Status == MembershipStatus.Suspended)
        {
            return Problems.Result(httpContext, StatusCodes.Status403Forbidden, "membership.suspended", "Your membership in this studio is suspended.");
        }

        if (membership.OrganizationStatus == OrganizationStatus.Suspended
            && httpContext.GetEndpoint()?.Metadata.GetMetadata<AllowWhenOrganizationSuspendedAttribute>() is null)
        {
            return Problems.Result(httpContext, StatusCodes.Status403Forbidden, "organization.suspended", "This studio is suspended.");
        }

        // A-5: owners and admins need MFA once the switch is on (before the pilot).
        if (mfaPolicy.Required && membership.Role is MembershipRole.Owner or MembershipRole.Admin && !account.MfaEnabled)
        {
            return Problems.Result(httpContext, StatusCodes.Status403Forbidden, "auth.mfa_required", "Set up two-step sign-in to manage this studio.");
        }

        var permissions = membership.EffectivePermissions;
        var required = httpContext.GetEndpoint()?.Metadata.GetMetadata<RequirePermissionAttribute>();
        if (required is null || !permissions.Contains(required.Permission))
        {
            return Problems.Result(httpContext, StatusCodes.Status403Forbidden, "permission.denied", "You do not have permission to do this.");
        }

        httpContext.Items[ItemKey] = new TenantContext(
            organizationId,
            account.UserAccountId,
            membership.MembershipId,
            membership.Role,
            membership.OrganizationStatus,
            httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier,
            permissions);

        return await next(context);
    }

    private static IResult NotFound(HttpContext httpContext) =>
        Problems.Result(httpContext, StatusCodes.Status404NotFound, "organization.not_found", "Studio not found.");
}
