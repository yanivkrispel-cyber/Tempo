using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.People;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Pass balance import from a file (docs/40): the console reads the CSV and posts its rows here, as a dry run first.
/// The route needs `people.import`; the service holds the rules, `passes.manage` included. This handler translates HTTP.
/// </summary>
public static class PassImportEndpoints
{
    public static IEndpointRouteBuilder MapPassImportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapPost("/passes/import", ImportAsync)
            .RequirePermission(Permissions.PeopleImport)
            .WithName("importPasses")
            .Produces<ImportPassesResultResponse>();

        return endpoints;
    }

    private static async Task<IResult> ImportAsync(HttpContext httpContext, ImportPassesRequest request, IPassImportService imports)
    {
        if (request.DryRun is not { } dryRun)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "dry_run.required", "Say whether this is a dry run.", "dryRun");
        }

        var rows = (request.Rows ?? [])
            .Select(r => new PassImportRowInput(r.Line, r.Email, r.Phone, r.Product, r.EntriesLeft, r.ValidFrom, r.ValidUntil))
            .ToList();
        var result = await imports.ImportAsync(TenantRouteFilter.Current(httpContext), dryRun, rows, httpContext.RequestAborted);

        return Results.Ok(new ImportPassesResultResponse(
            result.DryRun,
            result.ImportId,
            new ImportTotalsResponse(result.Totals.Rows, result.Totals.Valid, result.Totals.Created, result.Totals.Exists, result.Totals.DuplicateInFile, result.Totals.Invalid),
            [.. result.Rows.Select(o => new ImportPassRowResultResponse(o.Line, o.Outcome, o.PersonId, o.PassId, o.DuplicateOfLine, o.Field, o.Code))]));
    }
}
