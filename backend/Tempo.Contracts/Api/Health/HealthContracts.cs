namespace Tempo.Contracts.Api.Health;

/// <summary>`HealthFormQuestion` in contracts/openapi/tempo-api.v1.yaml (docs/31 section 3).</summary>
public sealed record HealthFormQuestionResponse(string Id, string Text);

/// <summary>`HealthForm`.</summary>
public sealed record HealthFormResponse(int Version, string Locale, IReadOnlyList<HealthFormQuestionResponse> Questions);

/// <summary>`HealthDeclarationStatusView`: status and dates only, never answers or names.</summary>
public sealed record HealthDeclarationStatusResponse(
    string Status,
    Guid? DeclarationId,
    int? FormVersion,
    string? SignerRole,
    DateTimeOffset? SignedAt,
    DateTimeOffset? ExpiresAt,
    DateOnly? MedicalApprovalOn);

/// <summary>`MyHealthDeclaration`.</summary>
public sealed record MyHealthDeclarationResponse(HealthDeclarationStatusResponse Declaration, HealthFormResponse Form, bool Required);

/// <summary>`HealthAnswer`: true is "yes".</summary>
public sealed record HealthAnswerResponse(string QuestionId, bool Answer);

/// <summary>`HealthAnswer` in a request; a missing answer is null and fails validation.</summary>
public sealed record HealthAnswerInput(string? QuestionId, bool? Answer);

/// <summary>`SignHealthDeclarationRequest`.</summary>
public sealed record SignHealthDeclarationRequest(int? FormVersion, IReadOnlyList<HealthAnswerInput>? Answers, string? SignedName, string? SignerRole, string? GuardianName, bool? Confirmed);

/// <summary>`HealthDeclarationAnswers`: the content; sent with `Cache-Control: no-store`.</summary>
public sealed record HealthDeclarationAnswersResponse(
    Guid DeclarationId,
    string Status,
    HealthFormResponse Form,
    IReadOnlyList<HealthAnswerResponse> Answers,
    string SignedName,
    string SignerRole,
    string? GuardianName,
    DateTimeOffset SignedAt,
    DateTimeOffset ExpiresAt,
    DateOnly? MedicalApprovalOn);

/// <summary>`MedicalApprovalRequest`.</summary>
public sealed record MedicalApprovalRequest(DateOnly? ApprovedOn);
