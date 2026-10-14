namespace Tempo.Contracts.Api.Common;

/// <summary>Public, unauthenticated contract for GET /api/v1/health.</summary>
public sealed record HealthResponse(
    string Status,
    string Environment,
    string Version,
    DateTimeOffset Timestamp,
    string CorrelationId);
