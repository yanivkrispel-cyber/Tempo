using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record BookingPolicyView(int FreeCancelHours, int WaitlistCutoffHours, int BookingHorizonDays, bool WaitlistEnabled, long Version);

public sealed record InboxItemView(Guid Id, string Kind, Guid? SessionId, Guid? BookingId, DateTimeOffset CreatedAt, DateTimeOffset? ReadAt);

public sealed record InboxPage(IReadOnlyList<InboxItemView> Items, int UnreadCount, Guid? NextBefore);

/// <summary>
/// The studio's booking policy (docs/29 section 6.1; no row means the defaults) and a member's in-app inbox
/// (section 3; delivery by push and email comes in Phase 4).
/// </summary>
public interface IStudioSettingsService
{
    Task<BookingPolicyView> GetPolicyAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<BookingPolicyView> UpdatePolicyAsync(TenantContext tenant, BookingPolicyView policy, long? expectedVersion, CancellationToken cancellationToken);

    Task<InboxPage> ListInboxAsync(TenantContext tenant, Guid? before, int limit, CancellationToken cancellationToken);

    Task MarkReadAsync(TenantContext tenant, Guid itemId, CancellationToken cancellationToken);
}

public sealed class StudioSettingsService(IDataSourceProvider dataSources) : IStudioSettingsService
{
    public async Task<BookingPolicyView> GetPolicyAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadPolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
    }

    public async Task<BookingPolicyView> UpdatePolicyAsync(TenantContext tenant, BookingPolicyView policy, long? expectedVersion, CancellationToken cancellationToken)
    {
        Range(policy.FreeCancelHours, 0, 72, "freeCancelHours");
        Range(policy.WaitlistCutoffHours, 0, 24, "waitlistCutoffHours");
        Range(policy.BookingHorizonDays, 1, 56, "bookingHorizonDays");

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = await ReadPolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        if (expectedVersion is { } expected && expected != current.Version)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
        }

        await using (var upsert = unitOfWork.Command(
            """
            INSERT INTO scheduling.booking_policies (organization_id, free_cancel_hours, waitlist_cutoff_hours, booking_horizon_days, waitlist_enabled, updated_at, version)
            VALUES ($1, $2, $3, $4, $5, now(), 1)
            ON CONFLICT (organization_id) DO UPDATE
            SET free_cancel_hours = $2, waitlist_cutoff_hours = $3, booking_horizon_days = $4, waitlist_enabled = $5,
                updated_at = now(), version = scheduling.booking_policies.version + 1
            """,
            tenant.OrganizationId, policy.FreeCancelHours, policy.WaitlistCutoffHours, policy.BookingHorizonDays, policy.WaitlistEnabled))
        {
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "booking_policy.updated", "organization", tenant.OrganizationId, tenant.CorrelationId,
                new { policy.FreeCancelHours, policy.WaitlistCutoffHours, policy.BookingHorizonDays, policy.WaitlistEnabled }),
            cancellationToken);
        var updated = await ReadPolicyAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<InboxPage> ListInboxAsync(TenantContext tenant, Guid? before, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 100);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        if (person is null)
        {
            return new InboxPage([], 0, null);
        }

        var items = new List<InboxItemView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT id, kind, (data ->> 'sessionId')::uuid, (data ->> 'bookingId')::uuid, created_at, read_at
            FROM notifications.inbox_items
            WHERE organization_id = $1 AND person_id = $2 AND ($3::uuid IS NULL OR id < $3)
            ORDER BY id DESC
            LIMIT $4
            """,
            tenant.OrganizationId, person, before, limit + 1))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(new InboxItemView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetGuid(2),
                    await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetGuid(3),
                    await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
                    await reader.IsDBNullAsync(5, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken)));
            }
        }

        await using var unread = unitOfWork.Command(
            "SELECT count(*)::int FROM notifications.inbox_items WHERE organization_id = $1 AND person_id = $2 AND read_at IS NULL",
            tenant.OrganizationId, person);
        var unreadCount = (int)(await unread.ExecuteScalarAsync(cancellationToken))!;
        var page = items.Take(limit).ToList();
        return new InboxPage(page, unreadCount, items.Count > limit ? page[^1].Id : null);
    }

    public async Task MarkReadAsync(TenantContext tenant, Guid itemId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        await using var update = unitOfWork.Command(
            "UPDATE notifications.inbox_items SET read_at = coalesce(read_at, now()) WHERE organization_id = $1 AND id = $2 AND person_id = $3",
            tenant.OrganizationId, itemId, person);
        if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "notification.not_found", "Notification not found.");
        }

        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static async Task<BookingPolicyView> ReadPolicyAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT coalesce(p.free_cancel_hours, 6), coalesce(p.waitlist_cutoff_hours, 2), coalesce(p.booking_horizon_days, 14),
                   coalesce(p.waitlist_enabled, true), coalesce(p.version, 0)
            FROM (SELECT 1) one
            LEFT JOIN scheduling.booking_policies p ON p.organization_id = $1
            """,
            organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return new BookingPolicyView(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetBoolean(3), reader.GetInt64(4));
    }

    private static async Task<Guid?> MyPersonAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) as Guid?;
    }

    private static void Range(int value, int min, int max, string field)
    {
        if (value < min || value > max)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", $"Use {min} to {max}.", field);
        }
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
