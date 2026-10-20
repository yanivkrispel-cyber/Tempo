using System.Text.RegularExpressions;
using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Marketing;

/// <summary>
/// Where a sign-up or a booking came from (docs/37 section 6, M-12): the `src` code of a link the studio handed out,
/// resolved inside the studio. A code that is malformed or unknown is ignored, never an error; a source is set once.
/// </summary>
public static partial class SourceLinks
{
    public static async Task<Guid?> FindAsync(UnitOfWork unitOfWork, Guid organizationId, string? code, CancellationToken cancellationToken)
    {
        if (code is null || !CodePattern().IsMatch(code))
        {
            return null;
        }

        await using var find = unitOfWork.Command("SELECT id FROM marketing.links WHERE organization_id = $1 AND code = $2", organizationId, code);
        return await find.ExecuteScalarAsync(cancellationToken) as Guid?;
    }

    /// <summary>The last touch on a member's own booking.</summary>
    public static async Task MarkBookingAsync(UnitOfWork unitOfWork, Guid organizationId, Guid bookingId, string? code, CancellationToken cancellationToken)
    {
        if (await FindAsync(unitOfWork, organizationId, code, cancellationToken) is not { } link)
        {
            return;
        }

        await using var mark = unitOfWork.Command(
            "UPDATE scheduling.bookings SET source_link_id = $3 WHERE organization_id = $1 AND id = $2 AND source_link_id IS NULL",
            organizationId, bookingId, link);
        await mark.ExecuteNonQueryAsync(cancellationToken);
    }

    [GeneratedRegex("^[a-z0-9]{6,10}$")]
    private static partial Regex CodePattern();
}
