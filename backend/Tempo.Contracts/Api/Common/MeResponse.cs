namespace Tempo.Contracts.Api.Common;

/// <summary>
/// Reflects the caller's Cognito JWT claims (GET /api/v1/me). This is
/// technical plumbing to validate authentication end to end - it is not the
/// internal user/membership model, which is defined by the future
/// Identity/Membership LLD.
/// </summary>
public sealed record MeResponse(string Subject, string? Email, bool EmailVerified, string CorrelationId);
