namespace Tempo.Contracts.Api.Support;

/// <summary>`SupportContact` in contracts/openapi/tempo-api.v1.yaml (board #584, PL-4): both null when none is set.</summary>
public sealed record SupportContactResponse(string? Contact, string? Kind);
