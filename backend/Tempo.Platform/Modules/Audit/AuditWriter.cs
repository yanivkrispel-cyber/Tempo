using System.Text.Json;
using NpgsqlTypes;
using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.Audit;

/// <summary>
/// One audit event (docs/26 section 10.1). Organization is null for
/// account-level events. <see cref="Data"/> holds the changed fields, before
/// and after, and never tokens, codes or hashes.
/// </summary>
public sealed record AuditEvent(
    Guid? OrganizationId,
    string ActorType,
    Guid? ActorId,
    string Action,
    string TargetType,
    Guid? TargetId,
    string CorrelationId,
    object? Data = null);

/// <summary>
/// Appends audit events inside the caller's unit of work, so an event commits
/// or rolls back with the change it records. The table is append-only.
/// </summary>
public static class AuditWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task WriteAsync(UnitOfWork unitOfWork, AuditEvent auditEvent, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, target_id, correlation_id, data)
            VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9)
            """,
            Guid.CreateVersion7(),
            auditEvent.OrganizationId,
            auditEvent.ActorType,
            auditEvent.ActorId,
            auditEvent.Action,
            auditEvent.TargetType,
            auditEvent.TargetId,
            auditEvent.CorrelationId,
            JsonSerializer.Serialize(auditEvent.Data ?? new { }, JsonOptions));
        command.Parameters[8].NpgsqlDbType = NpgsqlDbType.Jsonb;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
