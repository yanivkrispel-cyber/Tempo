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
        Result(httpContext, StatusOf(violation.Kind), violation.Code, violation.Message);

    public static async Task WriteAsync(HttpContext httpContext, int status, string code, string title)
    {
        httpContext.Response.StatusCode = status;
        httpContext.Response.ContentType = "application/problem+json";
        await httpContext.Response.WriteAsJsonAsync(Create(httpContext, status, code, title), (System.Text.Json.JsonSerializerOptions?)null, "application/problem+json");
    }

    public static int StatusOf(ViolationKind kind) => kind switch
    {
        ViolationKind.Validation => StatusCodes.Status400BadRequest,
        ViolationKind.Unauthorized => StatusCodes.Status401Unauthorized,
        ViolationKind.Forbidden => StatusCodes.Status403Forbidden,
        ViolationKind.NotFound => StatusCodes.Status404NotFound,
        ViolationKind.Conflict => StatusCodes.Status409Conflict,
        ViolationKind.TooManyRequests => StatusCodes.Status429TooManyRequests,
        _ => StatusCodes.Status400BadRequest
    };

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
