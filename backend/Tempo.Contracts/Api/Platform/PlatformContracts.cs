using System.Text.Json;

namespace Tempo.Contracts.Api.Platform;

public sealed record PlatformOwnerResponse(Guid UserAccountId, string Email, string? DisplayName);

public sealed record MemberCountsResponse(int Owner, int Admin, int Staff, int Client);

/// <summary>`PlatformOrganization` in contracts/openapi/tempo-api.v1.yaml.</summary>
public sealed record PlatformOrganizationResponse(
    Guid Id,
    string Slug,
    string DisplayName,
    string Status,
    DateTimeOffset CreatedAt,
    PlatformOwnerResponse Owner,
    MemberCountsResponse MemberCounts);

public sealed record PlatformOrganizationPageResponse(IReadOnlyList<PlatformOrganizationResponse> Items, Guid? NextBefore);

public sealed record ReasonRequest(string? Reason);

public sealed record PlatformStatsResponse(int ActiveOrganizations, int SuspendedOrganizations, int Accounts, int ActiveMemberships, int HourlyBackupThreshold);

/// <summary>`AuditEvent`: a studio's audit log entry. `Data` holds the changed fields.</summary>
public sealed record AuditEventResponse(
    Guid Id,
    DateTimeOffset OccurredAt,
    string ActorType,
    string? ActorDisplayName,
    string Action,
    string TargetType,
    Guid? TargetId,
    JsonElement Data);

public sealed record AuditEventPageResponse(IReadOnlyList<AuditEventResponse> Items, Guid? NextBefore);
