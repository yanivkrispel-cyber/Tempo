using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Notifications.Application;

public sealed record DeliveryLineView(
    Guid Id,
    string Kind,
    string Channel,
    string Status,
    string? Reason,
    int Attempts,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// A person's last delivery lines for the studio's "why didn't she get it?" (docs/30 section 13 step 7, D-6): kind,
/// channel, status, the skip reason or last error code, and times. Never the text, the endpoint or the address.
/// </summary>
public interface IDeliveryLogService
{
    Task<IReadOnlyList<DeliveryLineView>> ListAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);
}

public sealed class DeliveryLogService(IDataSourceProvider dataSources) : IDeliveryLogService
{
    public const int Limit = 30;

    public async Task<IReadOnlyList<DeliveryLineView>> ListAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
        await using (var person = unitOfWork.Command("SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, personId))
        {
            if (await person.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "This person is not in the studio.");
            }
        }

        var lines = new List<DeliveryLineView>();
        await using var command = unitOfWork.Command(
            $"""
            SELECT d.id, r.kind, d.channel, d.status, coalesce(d.skip_reason, d.last_error_code), d.attempts, d.created_at, d.updated_at
            FROM notifications.requests r
            JOIN notifications.deliveries d ON d.organization_id = r.organization_id AND d.request_id = r.id
            WHERE r.organization_id = $1 AND r.person_id = $2
            ORDER BY d.created_at DESC, d.id DESC
            LIMIT {Limit}
            """,
            tenant.OrganizationId, personId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            lines.Add(new(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetString(4),
                reader.GetInt32(5),
                await reader.GetFieldValueAsync<DateTimeOffset>(6, cancellationToken),
                await reader.GetFieldValueAsync<DateTimeOffset>(7, cancellationToken)));
        }

        return lines;
    }
}
