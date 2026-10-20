using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Organizations.Domain;

namespace Tempo.Platform.Modules.Organizations.Application;

/// <summary>What anyone may know about an active studio by its slug: its id, name and brand (docs/35 section 5).</summary>
public sealed record PublicStudio(Guid Id, string Slug, string DisplayName, BrandView Brand);

/// <summary>
/// Finds an active studio by its slug for the public routes (`/api/v1/public/studios/{slug}/...`): the manifest and
/// icons of WL4, and the public pages of docs/37 later. Read as the platform role, since no tenant is known yet. A
/// suspended or removed studio is not found.
/// </summary>
public interface IPublicStudioDirectory
{
    Task<PublicStudio?> FindAsync(string slug, CancellationToken cancellationToken);
}

public sealed class PublicStudioDirectory(IDataSourceProvider dataSources) : IPublicStudioDirectory
{
    public async Task<PublicStudio?> FindAsync(string slug, CancellationToken cancellationToken)
    {
        if (slug.Length is 0 or > 63)
        {
            return null;
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);
        await using var read = unitOfWork.Command(
            """
            SELECT o.id, o.slug, o.display_name, b.app_name, b.accent_id, b.icon_background, b.logo_media_id, b.icon_media_id, b.version
            FROM organizations.organizations o
            LEFT JOIN organizations.brands b ON b.organization_id = o.id
            WHERE o.slug = $1 AND o.status = 'active'
            """,
            slug);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var displayName = reader.GetString(2);
        if (reader.IsDBNull(3))
        {
            var defaults = new BrandView(Brand.DefaultAppName(displayName), Brand.DefaultAccent, Brand.DefaultIconBackground, null, null, false, 0);
            return new PublicStudio(reader.GetGuid(0), reader.GetString(1), displayName, defaults);
        }

        Guid? logo = reader.IsDBNull(6) ? null : reader.GetGuid(6);
        Guid? icon = reader.IsDBNull(7) ? null : reader.GetGuid(7);
        var brand = new BrandView(reader.GetString(3), reader.GetString(4), reader.GetString(5), logo, icon, true, reader.GetInt64(8));
        return new PublicStudio(reader.GetGuid(0), reader.GetString(1), displayName, brand);
    }
}
