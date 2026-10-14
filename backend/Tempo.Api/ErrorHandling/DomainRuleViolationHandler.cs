using Microsoft.AspNetCore.Diagnostics;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Api.ErrorHandling;

/// <summary>
/// Turns a <see cref="DomainRuleViolationException"/> into its Problem Details
/// answer. Registered before <see cref="GlobalExceptionHandler"/>, which
/// handles everything else as a 500.
/// </summary>
public sealed class DomainRuleViolationHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not DomainRuleViolationException violation)
        {
            return false;
        }

        await Problems.WriteAsync(httpContext, Problems.StatusOf(violation.Kind), violation.Code, violation.Message);
        return true;
    }
}
