using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Organizations.Domain;

namespace Tempo.Platform.Modules.Organizations.Infrastructure;

/// <summary>The studio's brand row (migration 0032), written on its first change with the defaults of docs/35.</summary>
public static class BrandRows
{
    /// <summary>Inserts the default row when the studio has none yet; the caller then locks and updates it.</summary>
    public static async Task EnsureAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        string displayName;
        await using (var name = unitOfWork.Command("SELECT display_name FROM organizations.organizations WHERE id = $1", organizationId))
        {
            displayName = (string)(await name.ExecuteScalarAsync(cancellationToken))!;
        }

        await using var insert = unitOfWork.Command(
            "INSERT INTO organizations.brands (organization_id, app_name, updated_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING",
            organizationId, Brand.DefaultAppName(displayName));
        await insert.ExecuteNonQueryAsync(cancellationToken);
    }
}
