using System.Text.Json;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Billing;

public sealed record PlanVersionView(Guid Id, string PlanKey, string DisplayName, long PriceMinor, string Currency, string Interval, IReadOnlyDictionary<string, JsonElement> Entitlements);

public sealed record BillingOverviewView(
    PlanVersionView Plan,
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
    long Version);

public sealed record BillingAccountChanges(string? BillingEmail, string? LegalName, string? BusinessId);

/// <summary>
/// Thin Phase 3 billing (docs/28, Kris's plan of 2026-10-15): the studio's plan, subscription state and
/// entitlements, and the billing details owners keep. No provider yet; every studio starts on the free pilot plan.
/// </summary>
public interface IBillingService
{
    Task<BillingOverviewView> GetAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<BillingOverviewView> UpdateAccountAsync(TenantContext tenant, BillingAccountChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<IReadOnlyList<PlanVersionView>> ListPublicPlansAsync(CancellationToken cancellationToken);
}

public sealed class BillingService(IDataSourceProvider dataSources) : IBillingService
{
    /// <summary>The pilot plan's first version, seeded by migration 0009.</summary>
    public static readonly Guid PilotPlanVersionId = Guid.Parse("00000000-0000-7000-8000-0000000000b2");

    public async Task<BillingOverviewView> GetAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await OverviewAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
    }

    public async Task<BillingOverviewView> UpdateAccountAsync(TenantContext tenant, BillingAccountChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        var email = changes.BillingEmail?.Trim();
        if (email is not null && (email.Length > 254 || !email.Contains('@', StringComparison.Ordinal)))
        {
            throw Invalid("billingEmail", "Enter a valid email address.");
        }

        var legalName = changes.LegalName?.Trim();
        if (legalName is { Length: 0 or > 120 })
        {
            throw Invalid("legalName", "Use 1 to 120 characters.");
        }

        if (changes.BusinessId is not null && !System.Text.RegularExpressions.Regex.IsMatch(changes.BusinessId, "^[0-9]{9}$"))
        {
            throw Invalid("businessId", "Use the 9-digit company or licensed-dealer number.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var update = unitOfWork.Command(
            """
            UPDATE billing.billing_accounts
            SET billing_email = coalesce($2, billing_email), legal_name = coalesce($3, legal_name), business_id = coalesce($4, business_id),
                updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND ($5::bigint IS NULL OR version = $5)
            """,
            tenant.OrganizationId, email, legalName, changes.BusinessId, expectedVersion))
        {
            if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
            }
        }

        // Audit keeps the names of the changed fields only: billing details identify a business, not a studio member.
        string[] fields = [.. new[] { ("billingEmail", email), ("legalName", legalName), ("businessId", changes.BusinessId) }.Where(f => f.Item2 is not null).Select(f => f.Item1)];
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "billing_account.updated", "organization", tenant.OrganizationId, tenant.CorrelationId, new { fields }),
            cancellationToken);
        var updated = await OverviewAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<IReadOnlyList<PlanVersionView>> ListPublicPlansAsync(CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        var ids = new List<Guid>();
        await using (var command = unitOfWork.Command("SELECT id FROM billing.plan_versions WHERE is_public ORDER BY price_minor"))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                ids.Add(reader.GetGuid(0));
            }
        }

        var plans = new List<PlanVersionView>();
        foreach (var id in ids)
        {
            plans.Add(await PlanAsync(unitOfWork, id, cancellationToken));
        }

        return plans;
    }

    /// <summary>Creates a new studio's billing account and active pilot subscription, inside its creation transaction.</summary>
    public static async Task OpenForNewStudioAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        var subscriptionId = Guid.CreateVersion7();
        await using (var account = unitOfWork.Command("INSERT INTO billing.billing_accounts (organization_id, created_at, updated_at) VALUES ($1, now(), now())", organizationId))
        {
            await account.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var subscription = unitOfWork.Command(
            """
            INSERT INTO billing.subscriptions (organization_id, id, plan_version_id, state, current_period_start, current_period_end, created_at, updated_at)
            VALUES ($1, $2, $3, 'active', now(), now() + interval '1 month', now(), now())
            """,
            organizationId, subscriptionId, PilotPlanVersionId))
        {
            await subscription.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var history = unitOfWork.Command(
            "INSERT INTO billing.subscription_events (organization_id, id, subscription_id, from_state, to_state, cause, actor_type, occurred_at) VALUES ($1, $2, $3, NULL, 'active', 'studio_created', 'system', now())",
            organizationId, Guid.CreateVersion7(), subscriptionId);
        await history.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Refuses creating one more of something above the studio's limit (docs/28 section 5.2), counted inside the
    /// caller's transaction. A missing key means no limit.
    /// </summary>
    public static async Task CheckLimitAsync(UnitOfWork unitOfWork, Guid organizationId, string key, string countSql, CancellationToken cancellationToken)
    {
        var entitlements = await EntitlementsAsync(unitOfWork, organizationId, cancellationToken);
        if (!entitlements.TryGetValue(key, out var limit) || limit.ValueKind != JsonValueKind.Number)
        {
            return;
        }

        await using var count = unitOfWork.Command(countSql, organizationId);
        var used = Convert.ToInt64(await count.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture);
        if (used >= limit.GetInt64())
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "entitlement.limit_reached", $"Your plan allows {limit.GetInt64()} ({key}).");
        }
    }

    /// <summary>The live plan's entitlements with unexpired operator overrides on top.</summary>
    public static async Task<IReadOnlyDictionary<string, JsonElement>> EntitlementsAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        await using (var plan = unitOfWork.Command(
            """
            SELECT e.key, e.value::text
            FROM billing.subscriptions s
            JOIN billing.plan_entitlements e ON e.plan_version_id = s.plan_version_id
            WHERE s.organization_id = $1 AND s.state <> 'canceled'
            """,
            organizationId))
        await using (var reader = await plan.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                result[reader.GetString(0)] = JsonDocument.Parse(reader.GetString(1)).RootElement.Clone();
            }
        }

        await using (var overrides = unitOfWork.Command(
            "SELECT key, value::text FROM billing.entitlement_overrides WHERE organization_id = $1 AND (ends_at IS NULL OR ends_at > now())",
            organizationId))
        await using (var reader = await overrides.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                result[reader.GetString(0)] = JsonDocument.Parse(reader.GetString(1)).RootElement.Clone();
            }
        }

        return result;
    }

    private static async Task<BillingOverviewView> OverviewAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        Guid planVersion;
        string state;
        DateTimeOffset? trialEnds, periodEnd, graceEnds;
        string provider;
        string? email, legalName, businessId, card;
        long version;
        await using (var command = unitOfWork.Command(
            """
            SELECT s.plan_version_id, s.state, s.trial_ends_at, s.current_period_end, s.grace_ends_at,
                   a.provider, a.billing_email, a.legal_name, a.business_id, a.card_last4, a.version
            FROM billing.subscriptions s
            JOIN billing.billing_accounts a ON a.organization_id = s.organization_id
            WHERE s.organization_id = $1 AND s.state <> 'canceled'
            """,
            organizationId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "billing.not_found", "This studio has no subscription.");
            }

            planVersion = reader.GetGuid(0);
            state = reader.GetString(1);
            trialEnds = await reader.IsDBNullAsync(2, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken);
            periodEnd = await reader.IsDBNullAsync(3, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(3, cancellationToken);
            graceEnds = await reader.IsDBNullAsync(4, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken);
            provider = reader.GetString(5);
            email = await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetString(6);
            legalName = await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetString(7);
            businessId = await reader.IsDBNullAsync(8, cancellationToken) ? null : reader.GetString(8);
            card = await reader.IsDBNullAsync(9, cancellationToken) ? null : reader.GetString(9);
            version = reader.GetInt64(10);
        }

        var plan = await PlanAsync(unitOfWork, planVersion, cancellationToken);
        var entitlements = await EntitlementsAsync(unitOfWork, organizationId, cancellationToken);
        return new BillingOverviewView(plan, state, provider, trialEnds, periodEnd, graceEnds, email, legalName, businessId, card, entitlements, version);
    }

    private static async Task<PlanVersionView> PlanAsync(UnitOfWork unitOfWork, Guid planVersionId, CancellationToken cancellationToken)
    {
        string key, name, currency, interval;
        long price;
        await using (var command = unitOfWork.Command(
            "SELECT p.key, p.display_name, v.price_minor, v.currency, v.interval FROM billing.plan_versions v JOIN billing.plans p ON p.id = v.plan_id WHERE v.id = $1",
            planVersionId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            key = reader.GetString(0);
            name = reader.GetString(1);
            price = reader.GetInt64(2);
            currency = reader.GetString(3).Trim();
            interval = reader.GetString(4);
        }

        var entitlements = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        await using (var command = unitOfWork.Command("SELECT key, value::text FROM billing.plan_entitlements WHERE plan_version_id = $1", planVersionId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                entitlements[reader.GetString(0)] = JsonDocument.Parse(reader.GetString(1)).RootElement.Clone();
            }
        }

        return new PlanVersionView(planVersionId, key, name, price, currency, interval, entitlements);
    }

    private static DomainRuleViolationException Invalid(string field, string message) =>
        new(ViolationKind.Validation, $"{field}.invalid", message, field);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
