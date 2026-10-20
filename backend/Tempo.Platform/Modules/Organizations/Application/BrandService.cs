using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Media;
using Tempo.Platform.Modules.Organizations.Domain;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Platform.Modules.Organizations.Application;

/// <summary>A studio's brand; <see cref="Customized"/> is false while the defaults stand (no row yet, version 0).</summary>
public sealed record BrandView(
    string AppName,
    string AccentId,
    string IconBackground,
    Guid? LogoMediaId,
    Guid? IconMediaId,
    bool Customized,
    long Version);

public sealed record BrandChanges(string? AppName, string? AccentId, string? IconBackground);

/// <summary>
/// The studio's brand (docs/35 section 2, WL1): its app name, accent and icon background. The logo and the icon are
/// set through the picture flow (purposes `studio_logo` and `studio_icon`). Any member reads it, since the member app
/// dresses itself in it; `organization.settings.manage` changes it.
/// </summary>
public interface IBrandService
{
    Task<BrandView> GetAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<BrandView> UpdateAsync(TenantContext tenant, BrandChanges changes, long? expectedVersion, CancellationToken cancellationToken);
}

public sealed class BrandService(IDataSourceProvider dataSources, IMediaStore store) : IBrandService
{
    private const string Columns = "app_name, accent_id, icon_background, logo_media_id, icon_media_id, version";

    public async Task<BrandView> GetAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadAsync(unitOfWork, tenant.OrganizationId, lockRow: false, cancellationToken);
    }

    public async Task<BrandView> UpdateAsync(TenantContext tenant, BrandChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (!tenant.Has(Permissions.OrganizationSettingsManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You can't change the studio's brand.");
        }

        var appName = Brand.ValidAppName(changes.AppName);
        var accent = Brand.ValidAccent(changes.AccentId);
        var background = Brand.ValidIconBackground(changes.IconBackground);

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var before = await ReadAsync(unitOfWork, tenant.OrganizationId, lockRow: true, cancellationToken);
        if (expectedVersion is { } expected && expected != before.Version)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
        }

        var fields = new List<string>();
        if (appName != before.AppName)
        {
            fields.Add("appName");
        }

        if (accent != before.AccentId)
        {
            fields.Add("accentId");
        }

        if (background != before.IconBackground)
        {
            fields.Add("iconBackground");
        }

        // Saving the same values changes nothing; saving the defaults for the first time keeps them as the studio's.
        if (fields.Count == 0 && before.Customized)
        {
            return before;
        }

        await BrandRows.EnsureAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await using (var update = unitOfWork.Command(
            "UPDATE organizations.brands SET app_name = $2, accent_id = $3, icon_background = $4, version = version + 1, updated_at = now() WHERE organization_id = $1",
            tenant.OrganizationId, appName, accent, background))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        // The icon's ground follows the accent and the background, so its PNGs are drawn again before the new version
        // is visible: an icon URL carries the version and is cached for a year.
        var newGround = Brand.IconGroundHex(accent, background);
        if (before.IconMediaId is { } icon && newGround != Brand.IconGroundHex(before.AccentId, before.IconBackground))
        {
            await RedrawIconAsync(tenant.OrganizationId, icon, newGround, cancellationToken);
        }

        // Field names only (docs/35 section 2): the values are the studio's, and the brand row has them.
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "brand.updated", "organization", tenant.OrganizationId, tenant.CorrelationId, new { fields }),
            cancellationToken);
        var after = await ReadAsync(unitOfWork, tenant.OrganizationId, lockRow: false, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    private async Task RedrawIconAsync(Guid organizationId, Guid iconId, string groundHex, CancellationToken cancellationToken)
    {
        var picture = await store.ReadAsync(MediaKeys.Large(organizationId, iconId), MediaService.MaxUploadBytes, cancellationToken);
        var icons = picture is null ? null : StudioIcons.Render(picture, groundHex);
        if (icons is null)
        {
            throw new DomainRuleViolationException(ViolationKind.ServiceUnavailable, "media.unavailable", "The icon could not be drawn again. Try again.");
        }

        foreach (var (size, png) in icons)
        {
            await store.WriteAsync(MediaKeys.Icon(organizationId, iconId, size), png, "image/png", cancellationToken);
        }
    }

    private static async Task<BrandView> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, bool lockRow, CancellationToken cancellationToken)
    {
        await using (var read = unitOfWork.Command($"SELECT {Columns} FROM organizations.brands WHERE organization_id = $1{(lockRow ? " FOR UPDATE" : "")}", organizationId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                return new BrandView(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetGuid(3),
                    reader.IsDBNull(4) ? null : reader.GetGuid(4),
                    true,
                    reader.GetInt64(5));
            }
        }

        await using var name = unitOfWork.Command("SELECT display_name FROM organizations.organizations WHERE id = $1", organizationId);
        var displayName = (string)(await name.ExecuteScalarAsync(cancellationToken))!;
        return new BrandView(Brand.DefaultAppName(displayName), Brand.DefaultAccent, Brand.DefaultIconBackground, null, null, false, 0);
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
