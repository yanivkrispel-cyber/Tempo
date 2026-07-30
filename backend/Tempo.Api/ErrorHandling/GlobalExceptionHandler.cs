using Microsoft.AspNetCore.Diagnostics;
using Tempo.Api.Middleware;

namespace Tempo.Api.ErrorHandling;

/// <summary>
/// Maps every unhandled exception to a Problem Details response. Exception
/// messages and stack traces are logged (server-side only) and never
/// returned to the caller - docs/20_Security.md section 7 / coding
/// standards section 6.
/// </summary>
public sealed class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var correlationId = httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier;

        logger.LogError(exception, "Unhandled exception processing {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        httpContext.Response.ContentType = "application/problem+json";

        await httpContext.Response.WriteAsJsonAsync(
            new Microsoft.AspNetCore.Mvc.ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An unexpected error occurred.",
                Type = "https://tempo.dev/problems/internal-error",
                Extensions = { ["correlationId"] = correlationId }
            },
            cancellationToken);

        return true;
    }
}
