using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Retention.Application;

/// <summary>
/// How long finished things are kept before the daily job deletes them (night board #136, B4; docs/20 section 9).
/// Invitations that are accepted, revoked, or pending past their expiry go <see cref="InvitationDays"/> days after
/// their last change; inbox items go <see cref="InboxItemDays"/> days after they were created, read or not; a
/// notification request and its deliveries go <see cref="DeliveryDays"/> days after the request (docs/30 D-6); a studio
/// announcement goes with the inbox items it fills, <see cref="InboxItemDays"/> days after it was sent (docs/30 section 10).
/// Archived people are not touched here: docs/27 keeps them seven years (P-2).
/// </summary>
/// <summary><paramref name="ReplacedHealthDeclarationDays"/> counts from the successor's signing (docs/31 H-8, provisional until P-2).</summary>
public sealed record RetentionPolicy(int InvitationDays, int InboxItemDays, int DeliveryDays, int ReplacedHealthDeclarationDays = 90)
{
    public static RetentionPolicy Default { get; } = new(90, 180, 90, 90);
}

/// <summary>
/// The daily retention job, run by the worker as the platform role across studios. Deletes only what the policy
/// says is past keeping and reports the counts; safe to run twice. Invitations hold an address and a role; inbox items,
/// requests and deliveries hold ids; announcements hold the studio's own words, kept no longer than their inbox items.
/// </summary>
public sealed class RetentionJob(IDataSourceProvider dataSources, TimeProvider clock, RetentionPolicy policy)
{
    public async Task<(int Invitations, int InboxItems, int Deliveries, int Announcements, int HealthDeclarations)> RunAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);

        // A pending invitation counts from its expiry, a finished one from the accept or revoke.
        await using var invitations = unitOfWork.Command(
            """
            DELETE FROM organizations.invitations
            WHERE (status IN ('accepted', 'revoked') AND updated_at <= $1)
               OR (status = 'pending' AND expires_at <= $1)
            """,
            now.AddDays(-policy.InvitationDays));
        var deletedInvitations = await invitations.ExecuteNonQueryAsync(cancellationToken);

        await using var inbox = unitOfWork.Command(
            "DELETE FROM notifications.inbox_items WHERE created_at <= $1",
            now.AddDays(-policy.InboxItemDays));
        var deletedInboxItems = await inbox.ExecuteNonQueryAsync(cancellationToken);

        // An announcement is never older than the inbox items that show it, so none is left without its text.
        await using var announcements = unitOfWork.Command(
            "DELETE FROM notifications.announcements WHERE created_at <= $1",
            now.AddDays(-policy.InboxItemDays));
        var deletedAnnouncements = await announcements.ExecuteNonQueryAsync(cancellationToken);

        // Deliveries first, so the count is theirs; then their requests. An inbox item that outlives its request
        // keeps a null link (0014).
        var deliveryCutoff = now.AddDays(-policy.DeliveryDays);
        await using var deliveries = unitOfWork.Command(
            """
            DELETE FROM notifications.deliveries d
            USING notifications.requests r
            WHERE r.organization_id = d.organization_id AND r.id = d.request_id AND r.created_at <= $1
            """,
            deliveryCutoff);
        var deletedDeliveries = await deliveries.ExecuteNonQueryAsync(cancellationToken);

        await using var requests = unitOfWork.Command(
            "DELETE FROM notifications.requests WHERE created_at <= $1",
            deliveryCutoff);
        await requests.ExecuteNonQueryAsync(cancellationToken);

        // A replaced health declaration (H-8): superseded_at is its successor's signing time. The current one stays
        // until the person is erased.
        await using var health = unitOfWork.Command(
            "DELETE FROM people.health_declarations WHERE superseded_at IS NOT NULL AND superseded_at <= $1",
            now.AddDays(-policy.ReplacedHealthDeclarationDays));
        var deletedHealthDeclarations = await health.ExecuteNonQueryAsync(cancellationToken);

        await unitOfWork.CommitAsync(cancellationToken);
        return (deletedInvitations, deletedInboxItems, deletedDeliveries, deletedAnnouncements, deletedHealthDeclarations);
    }
}
