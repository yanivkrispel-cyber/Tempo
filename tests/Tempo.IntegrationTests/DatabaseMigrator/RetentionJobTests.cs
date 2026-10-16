using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Retention.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>The retention job as the platform role (night board #136, B4): old finished things go, live ones stay, twice is safe.</summary>
public sealed class RetentionJobTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task TheJob_DeletesOldInvitationsInboxItemsAndAnnouncements_KeepsLiveOnes_Idempotently()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db);
        var person = (Guid)(await db.AsMasterAsync("SELECT id FROM people.people WHERE organization_id = $1", owner.OrganizationId))!;

        // Invitations: an old accepted one, an old revoked one, a long-expired pending one (all go); a fresh pending
        // one, a recently accepted one and a pending one that expired yesterday (all stay).
        await InvitationAsync(db, owner, "accepted", expiresAt: "now() - interval '120 days'", updatedAt: "now() - interval '100 days'");
        await InvitationAsync(db, owner, "revoked", expiresAt: "now() - interval '120 days'", updatedAt: "now() - interval '91 days'");
        await InvitationAsync(db, owner, "pending", expiresAt: "now() - interval '91 days'", updatedAt: "now() - interval '98 days'");
        await InvitationAsync(db, owner, "pending", expiresAt: "now() + interval '7 days'", updatedAt: "now()");
        await InvitationAsync(db, owner, "accepted", expiresAt: "now() - interval '1 day'", updatedAt: "now() - interval '10 days'");
        await InvitationAsync(db, owner, "pending", expiresAt: "now() - interval '1 day'", updatedAt: "now() - interval '8 days'");

        // Inbox items: one from 200 days ago (goes, read or not), one from yesterday (stays).
        await db.AsMasterAsync(
            "INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, read_at, created_at) VALUES ($1, $2, $3, 'booking.created', '{}', now() - interval '199 days', now() - interval '200 days')",
            owner.OrganizationId, Guid.CreateVersion7(), person);
        await db.AsMasterAsync(
            "INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, created_at) VALUES ($1, $2, $3, 'booking.created', '{}', now() - interval '1 day')",
            owner.OrganizationId, Guid.CreateVersion7(), person);

        // Notification requests: one from 100 days ago with two deliveries (all go), one from yesterday with one
        // delivery (stays). The old request's inbox item stays (180 days) and keeps a null link.
        var oldRequest = await RequestAsync(db, owner.OrganizationId, person, "now() - interval '100 days'", "inbox", "push");
        await RequestAsync(db, owner.OrganizationId, person, "now() - interval '1 day'", "inbox");
        var linkedItem = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, request_id, created_at) VALUES ($1, $2, $3, 'booking.promoted', '{}', $4, now() - interval '100 days')",
            owner.OrganizationId, linkedItem, person, oldRequest);

        // Announcements: one sent 200 days ago (goes, with its inbox items), one from yesterday (stays).
        foreach (var sentAt in new[] { "now() - interval '200 days'", "now() - interval '1 day'" })
        {
            await db.AsMasterAsync(
                $"INSERT INTO notifications.announcements (organization_id, id, subject, body, recipients, sent_by, created_at) VALUES ($1, $2, 'Closed', 'Closed on Friday.', 1, $3, {sentAt})",
                owner.OrganizationId, Guid.CreateVersion7(), owner.MembershipId);
        }

        var job = new RetentionJob(db, TimeProvider.System, RetentionPolicy.Default);
        var first = await job.RunAsync(CancellationToken.None);
        var second = await job.RunAsync(CancellationToken.None);

        first.Should().Be((3, 1, 2, 1));
        second.Should().Be((0, 0, 0, 0), "running twice changes nothing");
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.invitations WHERE organization_id = $1", owner.OrganizationId)).Should().Be(3L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE organization_id = $1", owner.OrganizationId)).Should().Be(2L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.requests WHERE organization_id = $1", owner.OrganizationId)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.deliveries WHERE organization_id = $1", owner.OrganizationId)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.announcements WHERE organization_id = $1", owner.OrganizationId)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT request_id IS NULL FROM notifications.inbox_items WHERE id = $1", linkedItem)).Should().Be(true);
    }

    private static async Task<Guid> RequestAsync(MigratedDatabase db, Guid org, Guid person, string createdAt, params string[] channels)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            $"INSERT INTO notifications.requests (organization_id, id, kind, person_id, subject_type, subject_id, dedupe_key, created_at) VALUES ($1, $2, 'booking.promoted', $3, 'booking', $4, $5, {createdAt})",
            org, id, person, Guid.CreateVersion7(), $"booking.promoted:{id}");
        foreach (var channel in channels)
        {
            await db.AsMasterAsync(
                $"INSERT INTO notifications.deliveries (organization_id, id, request_id, channel, status, created_at, updated_at) VALUES ($1, $2, $3, '{channel}', 'delivered', {createdAt}, {createdAt})",
                org, Guid.CreateVersion7(), id);
        }

        return id;
    }

    private static Task<object?> InvitationAsync(MigratedDatabase db, TenantContext owner, string status, string expiresAt, string updatedAt)
    {
        var token = new byte[32];
        Random.Shared.NextBytes(token);
        // Each row gets its own address: one pending invitation per address is a unique index.
        return db.AsMasterAsync(
            $"INSERT INTO organizations.invitations (organization_id, id, email, role, token_hash, status, expires_at, invited_by_membership_id, created_at, updated_at) VALUES ($1, $2, $3, 'staff', $4, '{status}', {expiresAt}, $5, now() - interval '200 days', {updatedAt})",
            owner.OrganizationId, Guid.CreateVersion7(), $"{Guid.NewGuid():N}@example.com", token, owner.MembershipId);
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }
}
