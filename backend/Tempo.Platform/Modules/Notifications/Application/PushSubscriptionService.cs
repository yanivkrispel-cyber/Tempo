using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Notifications.Infrastructure;

namespace Tempo.Platform.Modules.Notifications.Application;

public sealed record PushSubscriptionView(Guid Id, string DeviceLabel, DateTimeOffset CreatedAt, DateTimeOffset? LastSuccessAt);

/// <summary>
/// A member's devices that receive push from one studio (docs/30 section 4.3). Only the browser push services
/// are accepted as endpoints, so the worker never posts to an address a client made up.
/// </summary>
public interface IPushSubscriptionService
{
    Task<IReadOnlyList<PushSubscriptionView>> ListMineAsync(TenantContext tenant, CancellationToken cancellationToken);

    /// <summary>Returns the subscription and whether it is new; the same endpoint again returns the existing one.</summary>
    Task<(PushSubscriptionView Subscription, bool Created)> CreateMineAsync(TenantContext tenant, string endpoint, string p256dh, string auth, string deviceLabel, CancellationToken cancellationToken);

    Task DeleteMineAsync(TenantContext tenant, Guid subscriptionId, CancellationToken cancellationToken);
}

public sealed class PushSubscriptionService(IDataSourceProvider dataSources) : IPushSubscriptionService
{
    /// <summary>A person keeps at most this many devices per studio; the oldest goes when a new one comes.</summary>
    public const int MaxDevices = 10;

    public async Task<IReadOnlyList<PushSubscriptionView>> ListMineAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        return await ListAsync(unitOfWork, tenant.OrganizationId, person, null, cancellationToken);
    }

    public async Task<(PushSubscriptionView Subscription, bool Created)> CreateMineAsync(TenantContext tenant, string endpoint, string p256dh, string auth, string deviceLabel, CancellationToken cancellationToken)
    {
        if (!PushEndpoints.IsAllowed(endpoint))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "push.endpoint_invalid", "This is not a browser push service address.", "endpoint");
        }

        if (!KeysValid(p256dh, auth))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "push.keys_invalid", "The subscription keys do not decode.", "keys");
        }

        var label = deviceLabel.Trim();
        if (label.Length is < 1 or > 60)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "deviceLabel.invalid", "Use 1 to 60 characters.", "deviceLabel");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        var existing = await ListAsync(unitOfWork, tenant.OrganizationId, person, endpoint, cancellationToken);
        if (existing.Count == 1)
        {
            return (existing[0], false);
        }

        var id = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            "INSERT INTO notifications.push_subscriptions (organization_id, id, person_id, endpoint, p256dh, auth, device_label, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
            tenant.OrganizationId, id, person, endpoint, p256dh, auth, label))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var trim = unitOfWork.Command(
            """
            DELETE FROM notifications.push_subscriptions
            WHERE organization_id = $1 AND person_id = $2 AND id NOT IN (
                SELECT id FROM notifications.push_subscriptions WHERE organization_id = $1 AND person_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3)
            """,
            tenant.OrganizationId, person, MaxDevices))
        {
            await trim.ExecuteNonQueryAsync(cancellationToken);
        }

        // Ids only: the endpoint identifies a device, so it is not audit data.
        await AuditAsync(unitOfWork, tenant, "push_subscription.created", id, cancellationToken);
        var created = (await ListAsync(unitOfWork, tenant.OrganizationId, person, endpoint, cancellationToken)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return (created, true);
    }

    public async Task DeleteMineAsync(TenantContext tenant, Guid subscriptionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        await using (var delete = unitOfWork.Command(
            "DELETE FROM notifications.push_subscriptions WHERE organization_id = $1 AND id = $2 AND person_id = $3",
            tenant.OrganizationId, subscriptionId, person))
        {
            if (await delete.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "push_subscription.not_found", "Device not found.");
            }
        }

        await AuditAsync(unitOfWork, tenant, "push_subscription.deleted", subscriptionId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static bool KeysValid(string p256dh, string auth)
    {
        try
        {
            var point = Base64Url.Decode(p256dh);
            return point.Length == 65 && point[0] == 0x04 && Base64Url.Decode(auth).Length == 16;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static async Task<IReadOnlyList<PushSubscriptionView>> ListAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, string? endpoint, CancellationToken cancellationToken)
    {
        var items = new List<PushSubscriptionView>();
        await using var command = unitOfWork.Command(
            """
            SELECT id, device_label, created_at, last_success_at FROM notifications.push_subscriptions
            WHERE organization_id = $1 AND person_id = $2 AND ($3::text IS NULL OR endpoint = $3)
            ORDER BY created_at DESC, id DESC
            """,
            organizationId, person, endpoint);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new PushSubscriptionView(
                reader.GetGuid(0),
                reader.GetString(1),
                await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken),
                await reader.IsDBNullAsync(3, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(3, cancellationToken)));
        }

        return items;
    }

    private static async Task<Guid> MyPersonAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) as Guid?
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "You have no member record in this studio.");
    }

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid id, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "push_subscription", id, tenant.CorrelationId),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
