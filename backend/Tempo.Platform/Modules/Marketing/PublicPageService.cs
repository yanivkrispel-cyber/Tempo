using System.Text.RegularExpressions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Marketing;

/// <summary>The studio's public page settings; version 0 while nothing was saved (the defaults: off, open join on).</summary>
public sealed record PublicPageView(
    bool Enabled,
    bool OpenJoin,
    Guid? IntroProductId,
    string? SuggestWeeklyAt,
    long Version,
    string? InstagramHandle = null,
    Guid? ReferralRewardProductId = null);

/// <summary>
/// A PUT of the public page. `enabled` and `openJoin` are required; every other field is kept when it isn't sent
/// (null here) and cleared when it is sent as null (a <see cref="Sent{T}"/> holding null), so a form that doesn't know a
/// field never erases it (#396 review).
/// </summary>
public sealed record PublicPageChanges(
    bool? Enabled,
    bool? OpenJoin,
    Sent<Guid?>? IntroProductId = null,
    Sent<string?>? SuggestWeeklyAt = null,
    Sent<string?>? InstagramHandle = null,
    Sent<Guid?>? ReferralRewardProductId = null);

/// <summary>A field the request did send, null included.</summary>
public readonly record struct Sent<T>(T Value);

/// <summary>
/// The studio's public page (docs/37 sections 4.4 and 5, M-7, M-8, M-9, M-13): whether strangers see it, whether they
/// may join without a code, which product is the intro offer, and when the weekly story is suggested. Staff read it
/// (the console shows the link); `organization.settings.manage` changes it.
/// </summary>
public interface IPublicPageService
{
    Task<PublicPageView> GetAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<PublicPageView> UpdateAsync(TenantContext tenant, PublicPageChanges changes, long? expectedVersion, CancellationToken cancellationToken);
}

public sealed partial class PublicPageService(IDataSourceProvider dataSources) : IPublicPageService
{
    private static readonly PublicPageView Defaults = new(false, true, null, null, 0);

    public async Task<PublicPageView> GetAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadAsync(unitOfWork, tenant.OrganizationId, lockRow: false, cancellationToken) ?? Defaults;
    }

    public async Task<PublicPageView> UpdateAsync(TenantContext tenant, PublicPageChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (!tenant.Has(Permissions.OrganizationSettingsManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You can't change the studio's public page.");
        }

        var enabled = changes.Enabled ?? throw Required("enabled");
        var openJoin = changes.OpenJoin ?? throw Required("openJoin");
        var weekly = changes.SuggestWeeklyAt is { } sentWeekly ? Weekly(sentWeekly.Value) : null;
        var handle = changes.InstagramHandle is { } sentHandle ? Handle(sentHandle.Value) : null;
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var before = await ReadAsync(unitOfWork, tenant.OrganizationId, lockRow: true, cancellationToken) ?? Defaults;
        if (expectedVersion is { } expected && expected != before.Version)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
        }

        // A product is checked only when it is sent: a kept one stays as it was.
        var intro = changes.IntroProductId is { } sentIntro ? sentIntro.Value : before.IntroProductId;
        var reward = changes.ReferralRewardProductId is { } sentReward ? sentReward.Value : before.ReferralRewardProductId;
        if (changes.IntroProductId is not null)
        {
            await ActiveProductAsync(unitOfWork, tenant.OrganizationId, intro, "introProductId", cancellationToken);
        }

        if (changes.ReferralRewardProductId is not null)
        {
            await ActiveProductAsync(unitOfWork, tenant.OrganizationId, reward, "referralRewardProductId", cancellationToken);
        }

        var after = new PublicPageView(
            enabled,
            openJoin,
            intro,
            changes.SuggestWeeklyAt is null ? before.SuggestWeeklyAt : weekly,
            before.Version + 1,
            changes.InstagramHandle is null ? before.InstagramHandle : handle,
            reward);
        var fields = new[]
        {
            (after.Enabled != before.Enabled, "enabled"),
            (after.OpenJoin != before.OpenJoin, "openJoin"),
            (after.IntroProductId != before.IntroProductId, "introProductId"),
            (after.SuggestWeeklyAt != before.SuggestWeeklyAt, "suggestWeeklyAt"),
            (after.InstagramHandle != before.InstagramHandle, "instagramHandle"),
            (after.ReferralRewardProductId != before.ReferralRewardProductId, "referralRewardProductId")
        }.Where(f => f.Item1).Select(f => f.Item2).ToList();
        if (fields.Count == 0 && before.Version > 0)
        {
            return before;
        }

        await using (var upsert = unitOfWork.Command(
            """
            INSERT INTO organizations.public_pages
                (organization_id, enabled, open_join, intro_product_id, suggest_weekly_at, instagram_handle, referral_reward_product_id, version, updated_at, updated_by)
            VALUES ($1, $2, $3, $4, $5, $7, $8, 1, now(), $6)
            ON CONFLICT (organization_id) DO UPDATE SET
                enabled = EXCLUDED.enabled, open_join = EXCLUDED.open_join, intro_product_id = EXCLUDED.intro_product_id,
                suggest_weekly_at = EXCLUDED.suggest_weekly_at, instagram_handle = EXCLUDED.instagram_handle,
                referral_reward_product_id = EXCLUDED.referral_reward_product_id, version = organizations.public_pages.version + 1,
                updated_at = now(), updated_by = EXCLUDED.updated_by
            """,
            tenant.OrganizationId, after.Enabled, after.OpenJoin, after.IntroProductId, after.SuggestWeeklyAt, tenant.MembershipId, after.InstagramHandle, after.ReferralRewardProductId))
        {
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        // Field names only (docs/37 section 5).
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "public_page.updated", "organization", tenant.OrganizationId, tenant.CorrelationId, new { fields }),
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    private static async Task<PublicPageView?> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, bool lockRow, CancellationToken cancellationToken)
    {
        await using var read = unitOfWork.Command(
            $"SELECT enabled, open_join, intro_product_id, suggest_weekly_at, version, instagram_handle, referral_reward_product_id FROM organizations.public_pages WHERE organization_id = $1{(lockRow ? " FOR UPDATE" : "")}",
            organizationId);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        Guid? product = reader.IsDBNull(2) ? null : reader.GetGuid(2);
        string? weekly = reader.IsDBNull(3) ? null : reader.GetString(3);
        string? handle = reader.IsDBNull(5) ? null : reader.GetString(5);
        Guid? reward = reader.IsDBNull(6) ? null : reader.GetGuid(6);
        return new PublicPageView(reader.GetBoolean(0), reader.GetBoolean(1), product, weekly, reader.GetInt64(4), handle, reward);
    }

    /// <summary>A handle, "@handle" or an instagram.com link become the handle alone (M-15); empty clears it.</summary>
    private static string? Handle(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        var handle = HandleInLink().Match(text) is { Success: true } link ? link.Groups[1].Value : text.TrimStart('@');
        return HandlePattern().IsMatch(handle)
            ? handle
            : throw new DomainRuleViolationException(ViolationKind.Validation, "instagramHandle.invalid", "Use the studio's Instagram handle.", "instagramHandle");
    }

    private static string? Weekly(string? value)
    {
        var weekly = string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
        return weekly is null || WeeklyPattern().IsMatch(weekly)
            ? weekly
            : throw new DomainRuleViolationException(ViolationKind.Validation, "suggestWeeklyAt.invalid", "Use a day and a time, like \"sun 09:00\".", "suggestWeeklyAt");
    }

    private static async Task ActiveProductAsync(UnitOfWork unitOfWork, Guid organizationId, Guid? productId, string field, CancellationToken cancellationToken)
    {
        if (productId is not { } product)
        {
            return;
        }

        await using var active = unitOfWork.Command(
            "SELECT 1 FROM scheduling.pass_products WHERE organization_id = $1 AND id = $2 AND status = 'active'",
            organizationId, product);
        if (await active.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", "Choose one of the studio's active products.", field);
        }
    }

    [GeneratedRegex("^[A-Za-z0-9._]{1,30}$")]
    private static partial Regex HandlePattern();

    [GeneratedRegex(@"^https?://(?:www\.)?instagram\.com/([A-Za-z0-9._]{1,30})/?", RegexOptions.IgnoreCase)]
    private static partial Regex HandleInLink();

    private static DomainRuleViolationException Required(string field) =>
        new(ViolationKind.Validation, $"{field}.required", $"{field} is required.", field);

    [GeneratedRegex("^(sun|mon|tue|wed|thu|fri|sat) ([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex WeeklyPattern();

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
