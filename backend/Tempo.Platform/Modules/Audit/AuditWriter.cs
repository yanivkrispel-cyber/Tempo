using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Audit;

/// <summary>One audit event (docs/26 section 10.1). Organization is null for account-level events.</summary>
public sealed record AuditEvent(
    Guid? OrganizationId,
    string ActorType,
    Guid? ActorId,
    string Action,
    string TargetType,
    Guid? TargetId,
    string CorrelationId);

/// <summary>
/// Appends audit events inside the caller's unit of work, so an event commits
/// or rolls back with the change it records. The table is append-only.
/// </summary>
public static class AuditWriter
{
    public static async Task WriteAsync(UnitOfWork unitOfWork, AuditEvent auditEvent, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, target_id, correlation_id)
            VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8)
            """,
            Guid.CreateVersion7(),
            auditEvent.OrganizationId,
            auditEvent.ActorType,
            auditEvent.ActorId,
            auditEvent.Action,
            auditEvent.TargetType,
            auditEvent.TargetId,
            auditEvent.CorrelationId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
