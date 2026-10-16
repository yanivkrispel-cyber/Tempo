using System.Text.Json;

namespace Tempo.Contracts.Api.Billing;

/// <summary>`PlanVersion` in contracts/openapi/tempo-api.v1.yaml (docs/28).</summary>
public sealed record PlanVersionResponse(
    Guid Id,
    string PlanKey,
    string DisplayName,
    long PriceMinor,
    string Currency,
    string Interval,
    IReadOnlyDictionary<string, JsonElement> Entitlements);

public sealed record PlanListResponse(IReadOnlyList<PlanVersionResponse> Items);

/// <summary>`BillingOverview`: the studio's plan, subscription state, billing details and entitlements.</summary>
public sealed record BillingOverviewResponse(
    PlanVersionResponse Plan,
    string State,
    string Provider,
    DateTimeOffset? TrialEndsAt,
    DateTimeOffset? CurrentPeriodEnd,
    DateTimeOffset? GraceEndsAt,
    string? BillingEmail,
    string? LegalName,
    string? BusinessId,
    string? CardLast4,
    IReadOnlyDictionary<string, JsonElement> Entitlements,
    string Version);

public sealed record UpdateBillingAccountRequest(string? BillingEmail, string? LegalName, string? BusinessId);
