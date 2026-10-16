using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Retention.Application;

/// <summary>
/// How long finished things are kept before the daily job deletes them (night board #136, B4; docs/20 section 9).
/// Invitations that are accepted, revoked, or pending past their expiry go <see cref="InvitationDays"/> days after
/// their last change; inbox items go <see cref="InboxItemDays"/> days after they were created, read or not.
/// Archived people are not touched here: docs/27 keeps them seven years (P-2).
/// </summary>
public sealed record RetentionPolicy(int InvitationDays, int InboxItemDays)
{
    public static RetentionPolicy Default { get; } = new(90, 180);
}

/// <summary>
/// The daily retention job, run by the worker as the platform role across studios. Deletes only what the policy
/// says is past keeping, in two statements, and reports the counts; safe to run twice. Nothing it deletes carries
/// a person's words: invitations hold an address and a role, inbox items hold ids.
/// </summary>
public sealed class RetentionJob(IDataSourceProvider dataSources, TimeProvider clock, RetentionPolicy policy)
{
    public async Task<(int Invitations, int InboxItems)> RunAsync(CancellationToken cancellationToken)
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

        await unitOfWork.CommitAsync(cancellationToken);
        return (deletedInvitations, deletedInboxItems);
    }
}
