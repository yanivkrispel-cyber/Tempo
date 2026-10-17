namespace Tempo.Contracts.Api.People;

/// <summary>`ImportPeopleRequest` in contracts/openapi/tempo-api.v1.yaml (docs/34 section 4).</summary>
public sealed record ImportPeopleRequest(bool? DryRun, IReadOnlyList<ImportRowRequest>? Rows, Guid? TagId);

/// <summary>`ImportRow`: the cells as the file has them.</summary>
public sealed record ImportRowRequest(
    int Line,
    string? DisplayName,
    string? GivenName,
    string? FamilyName,
    string? Phone,
    string? Email,
    string? BirthDate);

/// <summary>`ImportPeopleResult`.</summary>
public sealed record ImportPeopleResultResponse(bool DryRun, Guid? ImportId, ImportTotalsResponse Totals, IReadOnlyList<ImportRowResultResponse> Rows);

/// <summary>`ImportTotals`.</summary>
public sealed record ImportTotalsResponse(int Rows, int Valid, int Created, int Exists, int DuplicateInFile, int Invalid);

/// <summary>`ImportRowResult`.</summary>
public sealed record ImportRowResultResponse(
    int Line,
    string Outcome,
    Guid? PersonId,
    int? DuplicateOfLine,
    bool PossibleDuplicate,
    string? Field,
    string? Code);
