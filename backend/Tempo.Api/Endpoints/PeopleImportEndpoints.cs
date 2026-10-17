using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Member import from a file (docs/34 sections 4 to 6): the console reads the CSV and posts its rows here, as a dry run
/// first. The service holds the rules; this handler translates HTTP.
/// </summary>
public static class PeopleImportEndpoints
{
    public static IEndpointRouteBuilder MapPeopleImportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapPost("/people/import", ImportAsync)
            .RequirePermission(Permissions.PeopleImport)
            .WithName("importPeople")
            .Produces<ImportPeopleResultResponse>();

        return endpoints;
    }

    private static async Task<IResult> ImportAsync(HttpContext httpContext, ImportPeopleRequest request, IPeopleImportService imports)
    {
        if (request.DryRun is not { } dryRun)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "dry_run.required", "Say whether this is a dry run.", "dryRun");
        }

        var rows = (request.Rows ?? [])
            .Select(r => new ImportRowInput(r.Line, r.DisplayName, r.GivenName, r.FamilyName, r.Phone, r.Email, r.BirthDate))
            .ToList();
        var result = await imports.ImportAsync(TenantRouteFilter.Current(httpContext), dryRun, rows, httpContext.RequestAborted, request.TagId);

        return Results.Ok(new ImportPeopleResultResponse(
            result.DryRun,
            result.ImportId,
            new ImportTotalsResponse(result.Totals.Rows, result.Totals.Valid, result.Totals.Created, result.Totals.Exists, result.Totals.DuplicateInFile, result.Totals.Invalid),
            [.. result.Rows.Select(o => new ImportRowResultResponse(o.Line, o.Outcome, o.PersonId, o.DuplicateOfLine, o.PossibleDuplicate, o.Field, o.Code))]));
    }
}
