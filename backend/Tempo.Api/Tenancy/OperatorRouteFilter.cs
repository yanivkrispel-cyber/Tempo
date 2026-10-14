using Tempo.Api.ErrorHandling;
using Tempo.Api.Middleware;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Api.Tenancy;

/// <summary>
/// Every `/api/v1/platform/*` route: the operator-pool token must belong to a
/// registered, active operator (docs/26 section 9), otherwise 403
/// `operator.not_registered`. Builds the <see cref="OperatorContext"/>.
/// </summary>
public sealed class OperatorRouteFilter(IOperatorDirectory operators) : IEndpointFilter
{
    private const string ItemKey = "Tempo.OperatorContext";

    public static OperatorContext Current(HttpContext httpContext) =>
        httpContext.Items[ItemKey] as OperatorContext
        ?? throw new InvalidOperationException("No operator context: the endpoint is not in the platform route group.");

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;
        var issuer = httpContext.User.FindFirst("iss")?.Value;
        var subject = httpContext.User.FindFirst("sub")?.Value;
        var found = string.IsNullOrEmpty(issuer) || string.IsNullOrEmpty(subject)
            ? null
            : await operators.FindActiveAsync(issuer, subject, httpContext.RequestAborted);

        if (found is not { } registered)
        {
            return Problems.Result(httpContext, StatusCodes.Status403Forbidden, "operator.not_registered", "This sign-in is not a registered Tempo operator.");
        }

        httpContext.Items[ItemKey] = new OperatorContext(
            registered.OperatorId,
            registered.Email,
            httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier);

        return await next(context);
    }
}
