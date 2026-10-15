namespace Tempo.Contracts.Api.Authorization;

/// <summary>`RoleSummary` in contracts/openapi/tempo-api.v1.yaml (Phase 2).</summary>
public sealed record RoleSummaryResponse(Guid Id, string Key, string DisplayName, bool IsSystem);

/// <summary>`PendingOwnershipTransfer`: direction is `outgoing` (the owner) or `incoming` (the target admin).</summary>
public sealed record PendingOwnershipTransferResponse(Guid Id, string Direction, DateTimeOffset ExpiresAt);
