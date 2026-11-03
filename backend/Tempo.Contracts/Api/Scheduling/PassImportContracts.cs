using Tempo.Contracts.Api.People;

namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`ImportPassesRequest` in contracts/openapi/tempo-api.v1.yaml (docs/40 section 3).</summary>
public sealed record ImportPassesRequest(bool? DryRun, IReadOnlyList<ImportPassRowRequest>? Rows);

/// <summary>`ImportPassRow`: the cells as the file has them; the API validates and normalizes.</summary>
public sealed record ImportPassRowRequest(
    int Line,
    string? Email,
    string? Phone,
    string? Product,
    string? EntriesLeft,
    string? ValidFrom,
    string? ValidUntil);

/// <summary>`ImportPassesResult`.</summary>
public sealed record ImportPassesResultResponse(bool DryRun, Guid? ImportId, ImportTotalsResponse Totals, IReadOnlyList<ImportPassRowResultResponse> Rows);

/// <summary>`ImportPassRowResult`.</summary>
public sealed record ImportPassRowResultResponse(
    int Line,
    string Outcome,
    Guid? PersonId,
    Guid? PassId,
    int? DuplicateOfLine,
    string? Field,
    string? Code);
