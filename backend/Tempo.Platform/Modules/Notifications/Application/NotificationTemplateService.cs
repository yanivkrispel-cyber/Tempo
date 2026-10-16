using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Notifications.Domain;

namespace Tempo.Platform.Modules.Notifications.Application;

public sealed record TemplateSummary(string Kind, string Group, IReadOnlyList<string> Customized, DateTimeOffset? UpdatedAt);

/// <summary>One channel's words: the studio's (with its active version) or the default, and the preview on sample values.</summary>
public sealed record TemplateChannelView(TemplateWords Words, bool Studio, int? StudioVersion, TemplateWords Preview);

public sealed record NotificationTemplateView(TemplatedKind Kind, string Locale, TemplateChannelView Inbox, TemplateChannelView Push, long Version);

/// <summary>
/// A studio's own words per templated kind (docs/30 section 13 step 7). Each saved channel becomes a new active
/// version and the earlier one is retired; null retires the studio's version so the platform default applies.
/// The version sent back as If-Match counts the studio's rows and retirements for the kind and locale, so it moves
/// on every change.
/// </summary>
public interface INotificationTemplateService
{
    Task<IReadOnlyList<TemplateSummary>> ListAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<NotificationTemplateView> GetAsync(TenantContext tenant, string kind, string locale, CancellationToken cancellationToken);

    Task<NotificationTemplateView> UpdateAsync(TenantContext tenant, string kind, string locale, TemplateWords? inbox, TemplateWords? push, long? expectedVersion, CancellationToken cancellationToken);
}

public sealed class NotificationTemplateService(IDataSourceProvider dataSources) : INotificationTemplateService
{
    public async Task<IReadOnlyList<TemplateSummary>> ListAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        var customized = new Dictionary<string, (List<string> Channels, DateTimeOffset UpdatedAt)>(StringComparer.Ordinal);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var command = unitOfWork.Command(
            "SELECT kind, channel, created_at FROM notifications.templates WHERE organization_id = $1 AND locale = $2 AND status = 'active' ORDER BY channel",
            tenant.OrganizationId, TemplateCatalog.DefaultLocale))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var at = await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken);
                var entry = customized.TryGetValue(reader.GetString(0), out var found) ? found : ([], at);
                entry.Channels.Add(reader.GetString(1));
                customized[reader.GetString(0)] = (entry.Channels, at > entry.UpdatedAt ? at : entry.UpdatedAt);
            }
        }

        return [.. TemplateCatalog.Kinds.Select(k => customized.TryGetValue(k.Kind, out var c)
            ? new TemplateSummary(k.Kind, k.Group, c.Channels, c.UpdatedAt)
            : new TemplateSummary(k.Kind, k.Group, [], null))];
    }

    public async Task<NotificationTemplateView> GetAsync(TenantContext tenant, string kind, string locale, CancellationToken cancellationToken)
    {
        var templated = Known(kind);
        CheckLocale(locale);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadAsync(unitOfWork, tenant.OrganizationId, templated, locale, cancellationToken);
    }

    public async Task<NotificationTemplateView> UpdateAsync(
        TenantContext tenant, string kind, string locale, TemplateWords? inbox, TemplateWords? push, long? expectedVersion, CancellationToken cancellationToken)
    {
        var templated = Known(kind);
        CheckLocale(locale);
        if (inbox is not null)
        {
            TemplateText.Validate(templated, inbox, TemplateCatalog.Inbox);
        }

        if (push is not null)
        {
            TemplateText.Validate(templated, push, TemplateCatalog.Push);
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        // Two saves of the same kind wait for each other, so the second sees the first one's version: 409, never two
        // active rows or a lost change.
        await using (var lockCommand = unitOfWork.Command(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", $"notifications.templates:{tenant.OrganizationId}:{kind}:{locale}"))
        {
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        if (expectedVersion is { } expected && expected != await VersionAsync(unitOfWork, tenant.OrganizationId, kind, locale, cancellationToken))
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
        }

        foreach (var (channel, words) in new[] { (TemplateCatalog.Inbox, inbox), (TemplateCatalog.Push, push) })
        {
            await SaveChannelAsync(unitOfWork, tenant, kind, locale, channel, words, cancellationToken);
        }

        var updated = await ReadAsync(unitOfWork, tenant.OrganizationId, templated, locale, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    private static async Task SaveChannelAsync(UnitOfWork unitOfWork, TenantContext tenant, string kind, string locale, string channel, TemplateWords? words, CancellationToken cancellationToken)
    {
        var active = await NotificationTexts.ActiveAsync(unitOfWork, tenant.OrganizationId, kind, locale, channel, cancellationToken);
        if (active == words)
        {
            return;
        }

        await using (var retire = unitOfWork.Command(
            "UPDATE notifications.templates SET status = 'retired' WHERE organization_id = $1 AND kind = $2 AND locale = $3 AND channel = $4 AND status = 'active'",
            tenant.OrganizationId, kind, locale, channel))
        {
            await retire.ExecuteNonQueryAsync(cancellationToken);
        }

        int? version = null;
        if (words is not null)
        {
            await using var insert = unitOfWork.Command(
                """
                INSERT INTO notifications.templates (id, organization_id, kind, locale, channel, version, subject, body, status, created_by, created_at)
                SELECT $1, $2, $3, $4, $5, coalesce(max(version), 0) + 1, $6, $7, 'active', $8, now()
                FROM notifications.templates WHERE organization_id = $2 AND kind = $3 AND locale = $4 AND channel = $5
                RETURNING version
                """,
                Guid.CreateVersion7(), tenant.OrganizationId, kind, locale, channel, words.Subject, words.Body, tenant.MembershipId);
            version = (int)(await insert.ExecuteScalarAsync(cancellationToken))!;
        }

        // The audit keeps which words changed, never the words.
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "template.changed", "organization", tenant.OrganizationId, tenant.CorrelationId,
                new { kind, locale, channel, version }),
            cancellationToken);
    }

    private static async Task<NotificationTemplateView> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, TemplatedKind kind, string locale, CancellationToken cancellationToken)
    {
        var studio = new Dictionary<string, (TemplateWords Words, int Version)>(StringComparer.Ordinal);
        await using (var command = unitOfWork.Command(
            "SELECT channel, coalesce(subject, ''), body, version FROM notifications.templates WHERE organization_id = $1 AND kind = $2 AND locale = $3 AND status = 'active'",
            organizationId, kind.Kind, locale))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                studio[reader.GetString(0)] = (new TemplateWords(reader.GetString(1), reader.GetString(2)), reader.GetInt32(3));
            }
        }

        TemplateChannelView Channel(string channel)
        {
            var own = studio.TryGetValue(channel, out var found);
            var words = own ? found.Words : TemplateCatalog.Default(kind, channel);
            var preview = channel == TemplateCatalog.Push
                ? TemplateText.RenderPush(words, TemplateCatalog.SampleValues)
                : TemplateText.RenderInbox(words, TemplateCatalog.SampleValues);
            return new TemplateChannelView(words, own, own ? found.Version : null, preview);
        }

        return new NotificationTemplateView(
            kind, locale, Channel(TemplateCatalog.Inbox), Channel(TemplateCatalog.Push), await VersionAsync(unitOfWork, organizationId, kind.Kind, locale, cancellationToken));
    }

    private static async Task<long> VersionAsync(UnitOfWork unitOfWork, Guid organizationId, string kind, string locale, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT count(*) + count(*) FILTER (WHERE status = 'retired') FROM notifications.templates WHERE organization_id = $1 AND kind = $2 AND locale = $3",
            organizationId, kind, locale);
        return (long)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    private static TemplatedKind Known(string kind) =>
        TemplateCatalog.Find(kind) ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "template.kind_unknown", "This kind has no template.");

    private static void CheckLocale(string locale)
    {
        if (!TemplateCatalog.Locales.Contains(locale, StringComparer.Ordinal))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "locale.invalid", "Use he or en.", "locale");
        }
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
