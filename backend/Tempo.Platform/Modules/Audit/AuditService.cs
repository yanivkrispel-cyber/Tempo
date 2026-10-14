using System.Text.Json;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Audit;

public sealed record AuditEventView(
    Guid Id,
    DateTimeOffset OccurredAt,
    string ActorType,
    string? ActorDisplayName,
    string Action,
    string TargetType,
    Guid? TargetId,
    JsonElement Data);

public sealed record AuditEventPage(IReadOnlyList<AuditEventView> Items, Guid? NextBefore);

/// <summary>A studio's audit log for its owner and admins (docs/26 sections 8.2 and 10.1), newest first.</summary>
public interface IAuditService
{
    Task<AuditEventPage> ListAsync(TenantContext tenant, Guid? before, int limit, CancellationToken cancellationToken);
}

public sealed class AuditService(IDataSourceProvider dataSources, IAccountProfiles profiles) : IAuditService
{
    public async Task<AuditEventPage> ListAsync(TenantContext tenant, Guid? before, int limit, CancellationToken cancellationToken)
    {
        // Mirrors RolePolicy.CanViewAudit; the Audit module does not depend on Organizations.
        if (tenant.Role is not (MembershipRole.Owner or MembershipRole.Admin))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Your role in this studio does not allow this.");
        }

        limit = Math.Clamp(limit, 1, 100);
        var rows = new List<(AuditEventView Event, Guid? ActorId)>();
        await using (var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken))
        {
            await using var command = unitOfWork.Command(
                """
                SELECT id, occurred_at, actor_type, actor_id, action, target_type, target_id, data::text
                FROM audit.audit_events
                WHERE organization_id = $1 AND ($2::uuid IS NULL OR id < $2)
                ORDER BY id DESC
                LIMIT $3
                """,
                tenant.OrganizationId,
                before,
                limit + 1);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                using var data = JsonDocument.Parse(reader.GetString(7));
                Guid? actorId = await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetGuid(3);
                rows.Add((
                    new AuditEventView(
                        reader.GetGuid(0),
                        await reader.GetFieldValueAsync<DateTimeOffset>(1, cancellationToken),
                        reader.GetString(2),
                        null,
                        reader.GetString(4),
                        reader.GetString(5),
                        await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetGuid(6),
                        data.RootElement.Clone()),
                    actorId));
            }
        }

        var page = rows.Take(limit).ToList();

        // Names only for people; an operator shows as its actor type.
        var userIds = page.Where(r => r.Event.ActorType == "user" && r.ActorId is not null).Select(r => r.ActorId!.Value).Distinct().ToList();
        var names = await profiles.FindAsync(userIds, cancellationToken);
        var items = page
            .Select(r => r.Event.ActorType == "user" && r.ActorId is { } id && names.TryGetValue(id, out var profile)
                ? r.Event with { ActorDisplayName = profile.DisplayName ?? profile.Email }
                : r.Event)
            .ToList();

        return new AuditEventPage(items, rows.Count > limit ? page[^1].Event.Id : null);
    }
}
