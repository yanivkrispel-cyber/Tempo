using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Middleware;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Api.ErrorHandling;

/// <summary>
/// Problem Details with the stable `code` and the correlation id that every
/// error in the contract carries (contracts/openapi/tempo-api.v1.yaml,
/// `Problem`; docs/26 section 8.5).
/// </summary>
public static class Problems
{
    public static IResult Result(HttpContext httpContext, int status, string code, string title) =>
        Results.Problem(Create(httpContext, status, code, title));

    public static IResult Result(HttpContext httpContext, DomainRuleViolationException violation) =>
        Results.Problem(Create(httpContext, violation));

    public static Task WriteAsync(HttpContext httpContext, int status, string code, string title) =>
        WriteAsync(httpContext, Create(httpContext, status, code, title));

    public static Task WriteAsync(HttpContext httpContext, DomainRuleViolationException violation)
    {
        if (violation.RetryAfter is { } retryAfter)
        {
            httpContext.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        return WriteAsync(httpContext, Create(httpContext, violation));
    }

    public static int StatusOf(ViolationKind kind) => kind switch
    {
        ViolationKind.Validation => StatusCodes.Status400BadRequest,
        ViolationKind.Unauthorized => StatusCodes.Status401Unauthorized,
        ViolationKind.Forbidden => StatusCodes.Status403Forbidden,
        ViolationKind.NotFound => StatusCodes.Status404NotFound,
        ViolationKind.Conflict => StatusCodes.Status409Conflict,
        ViolationKind.Gone => StatusCodes.Status410Gone,
        ViolationKind.TooManyRequests => StatusCodes.Status429TooManyRequests,
        ViolationKind.ServiceUnavailable => StatusCodes.Status503ServiceUnavailable,
        _ => StatusCodes.Status400BadRequest
    };

    private static async Task WriteAsync(HttpContext httpContext, ProblemDetails problem)
    {
        httpContext.Response.StatusCode = problem.Status ?? StatusCodes.Status500InternalServerError;
        httpContext.Response.ContentType = "application/problem+json";
        await httpContext.Response.WriteAsJsonAsync(problem, (System.Text.Json.JsonSerializerOptions?)null, "application/problem+json", httpContext.RequestAborted);
    }

    private static ProblemDetails Create(HttpContext httpContext, DomainRuleViolationException violation)
    {
        var problem = Create(httpContext, StatusOf(violation.Kind), violation.Code, violation.Message);
        if (violation.Field is not null)
        {
            problem.Extensions["errors"] = new[] { new { field = violation.Field, code = violation.Code, message = violation.Message } };
        }

        foreach (var (name, value) in violation.Extensions ?? new Dictionary<string, object?>())
        {
            problem.Extensions[name] = value;
        }

        return problem;
    }

    private static ProblemDetails Create(HttpContext httpContext, int status, string code, string title) => new()
    {
        Status = status,
        Title = title,
        Type = $"https://tempo.dev/problems/{code}",
        Extensions =
        {
            ["code"] = code,
            ["correlationId"] = httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier
        }
    };
}
