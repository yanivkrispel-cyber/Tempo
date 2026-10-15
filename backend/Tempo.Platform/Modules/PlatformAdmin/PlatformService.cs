using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Platform.Modules.PlatformAdmin;

public sealed record MemberCounts(int Owner, int Admin, int Staff, int Client);

public sealed record PlatformOrganizationView(
    Guid Id,
    string Slug,
    string DisplayName,
    OrganizationStatus Status,
    DateTimeOffset CreatedAt,
    Guid OwnerAccountId,
    string OwnerEmail,
    string? OwnerDisplayName,
    MemberCounts MemberCounts);

public sealed record PlatformOrganizationPage(IReadOnlyList<PlatformOrganizationView> Items, Guid? NextBefore);

public sealed record PlatformStats(int ActiveOrganizations, int SuspendedOrganizations, int Accounts, int ActiveMemberships, int HourlyBackupThreshold);

/// <summary>
/// The operator console (docs/26 sections 8.4 and 9). Runs as `tempo_platform`,
/// which sees every tenant and may change only a studio's status. Every call
/// that touches one studio writes an audit event with actor type `operator`,
/// including reads.
///
/// The platform module reads across the other modules' tables on purpose: it
/// is the read model of the whole platform, and its role has no other rights.
/// </summary>
public interface IPlatformService
{
    Task<PlatformOrganizationPage> ListAsync(OrganizationStatus? status, Guid? before, int limit, CancellationToken cancellationToken);

    Task<PlatformOrganizationView> GetAsync(OperatorContext caller, Guid organizationId, CancellationToken cancellationToken);

    Task<PlatformOrganizationView> SetStatusAsync(OperatorContext caller, Guid organizationId, OrganizationStatus status, string reason, CancellationToken cancellationToken);

    Task<PlatformStats> StatsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Makes an active admin the owner when the owner is unreachable (docs/27 section 3.5), with a written
    /// reason and a support ticket. The only way to change the owner without the owner. Audited.
    /// </summary>
    Task<PlatformOrganizationView> ForceOwnerTransferAsync(OperatorContext caller, Guid organizationId, Guid toMembershipId, string reason, string ticket, CancellationToken cancellationToken);
}

public sealed class PlatformService(IDataSourceProvider dataSources) : IPlatformService, IOperatorDirectory
{
    /// <summary>Active studios at which the owner moves to hourly backups (ADR-0021, docs/26 section 10.2).</summary>
    public const int HourlyBackupThreshold = 10;

    private const string Select =
        """
        SELECT o.id, o.slug, o.display_name, o.status, o.created_at,
               ow.user_account_id, ua.email, ua.display_name,
               count(m.id) FILTER (WHERE m.role = 'owner'),
               count(m.id) FILTER (WHERE m.role = 'admin'),
               count(m.id) FILTER (WHERE m.role = 'staff'),
               count(m.id) FILTER (WHERE m.role = 'client')
        FROM organizations.organizations o
        JOIN organizations.memberships ow ON ow.organization_id = o.id AND ow.role = 'owner' AND ow.status <> 'removed'
        JOIN identity.user_accounts ua ON ua.id = ow.user_account_id
        LEFT JOIN organizations.memberships m ON m.organization_id = o.id AND m.status <> 'removed'
        """;

    private const string GroupBy = "GROUP BY o.id, ow.user_account_id, ua.email, ua.display_name";

    public async Task<(Guid OperatorId, string Email)?> FindActiveAsync(string issuer, string subject, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(cancellationToken);
        await using var command = unitOfWork.Command(
            "SELECT id, email FROM platform_admin.operators WHERE issuer = $1 AND subject = $2 AND status = 'active'",
            issuer,
            subject);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? (reader.GetGuid(0), reader.GetString(1)) : null;
    }

    public async Task<PlatformOrganizationPage> ListAsync(OrganizationStatus? status, Guid? before, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 100);
        var items = new List<PlatformOrganizationView>();
        await using (var unitOfWork = await BeginAsync(cancellationToken))
        {
            await using var command = unitOfWork.Command(
                $"""
                {Select}
                WHERE ($1::text IS NULL OR o.status = $1) AND ($2::uuid IS NULL OR o.id < $2)
                {GroupBy}
                ORDER BY o.id DESC
                LIMIT $3
                """,
                status is { } s ? StoredValue.Of(s) : null,
                before,
                limit + 1);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(await ReadAsync(reader, cancellationToken));
            }
        }

        var page = items.Take(limit).ToList();
        return new PlatformOrganizationPage(page, items.Count > limit ? page[^1].Id : null);
    }

    public async Task<PlatformOrganizationView> GetAsync(OperatorContext caller, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(cancellationToken);
        var studio = await FindAsync(unitOfWork, organizationId, cancellationToken);
        await AuditAsync(unitOfWork, caller, "organization.viewed_by_operator", organizationId, null, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return studio;
    }

    public async Task<PlatformOrganizationView> SetStatusAsync(OperatorContext caller, Guid organizationId, OrganizationStatus status, string reason, CancellationToken cancellationToken)
    {
        reason = reason.Trim();
        if (reason.Length is < 5 or > 500)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "reason.length", "Write a reason of 5 to 500 characters.", "reason");
        }

        await using var unitOfWork = await BeginAsync(cancellationToken);
        var before = await FindAsync(unitOfWork, organizationId, cancellationToken);
        if (before.Status == status)
        {
            return before;
        }

        await using (var update = unitOfWork.Command(
            "UPDATE organizations.organizations SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1",
            organizationId,
            StoredValue.Of(status)))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        var action = status == OrganizationStatus.Suspended ? "organization.suspended" : "organization.reactivated";
        await AuditAsync(unitOfWork, caller, action, organizationId, new { reason }, cancellationToken);
        var after = await FindAsync(unitOfWork, organizationId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    public async Task<PlatformOrganizationView> ForceOwnerTransferAsync(
        OperatorContext caller,
        Guid organizationId,
        Guid toMembershipId,
        string reason,
        string ticket,
        CancellationToken cancellationToken)
    {
        reason = reason.Trim();
        ticket = ticket.Trim();
        if (reason.Length is < 5 or > 500)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "reason.length", "Write a reason of 5 to 500 characters.", "reason");
        }

        if (ticket.Length is < 1 or > 100)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "ticket.required", "Name the support ticket.", "ticket");
        }

        await using var unitOfWork = await BeginAsync(cancellationToken);
        await FindAsync(unitOfWork, organizationId, cancellationToken);

        Guid? ownerId = null;
        string? targetRole = null;
        string? targetStatus = null;
        await using (var members = unitOfWork.Command(
            "SELECT id, role, status FROM organizations.memberships WHERE organization_id = $1 AND (id = $2 OR (role = 'owner' AND status <> 'removed')) FOR UPDATE",
            organizationId,
            toMembershipId))
        await using (var reader = await members.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                if (reader.GetGuid(0) == toMembershipId)
                {
                    targetRole = reader.GetString(1);
                    targetStatus = reader.GetString(2);
                }
                else
                {
                    ownerId = reader.GetGuid(0);
                }
            }
        }

        if (targetRole is null)
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "membership.not_found", "Member not found.");
        }

        if (targetRole != "admin" || targetStatus != "active")
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "ownership.target_not_admin", "The studio can go only to an active admin.");
        }

        // A studio always has an owner (ux_memberships_one_owner and the owner cannot leave).
        var fromId = ownerId ?? throw new InvalidOperationException($"Studio {organizationId} has no owner.");
        await OwnershipService.HandOverAsync(unitOfWork, organizationId, fromId, toMembershipId, null, cancellationToken);
        await AuditAsync(unitOfWork, caller, "ownership.transferred_by_operator", organizationId, new { from = fromId, to = toMembershipId, reason, ticket }, cancellationToken);
        var after = await FindAsync(unitOfWork, organizationId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    public async Task<PlatformStats> StatsAsync(CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(cancellationToken);
        await using var command = unitOfWork.Command(
            """
            SELECT (SELECT count(*) FROM organizations.organizations WHERE status = 'active'),
                   (SELECT count(*) FROM organizations.organizations WHERE status = 'suspended'),
                   (SELECT count(*) FROM identity.user_accounts),
                   (SELECT count(*) FROM organizations.memberships WHERE status = 'active')
            """);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return new PlatformStats((int)reader.GetInt64(0), (int)reader.GetInt64(1), (int)reader.GetInt64(2), (int)reader.GetInt64(3), HourlyBackupThreshold);
    }

    private static async Task<PlatformOrganizationView> FindAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command($"{Select} WHERE o.id = $1 {GroupBy}", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? await ReadAsync(reader, cancellationToken)
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "organization.not_found", "Studio not found.");
    }

    private static async Task<PlatformOrganizationView> ReadAsync(NpgsqlDataReader reader, CancellationToken cancellationToken) =>
        new(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            StoredValue.Parse<OrganizationStatus>(reader.GetString(3)),
            await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
            reader.GetGuid(5),
            reader.GetString(6),
            await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetString(7),
            new MemberCounts((int)reader.GetInt64(8), (int)reader.GetInt64(9), (int)reader.GetInt64(10), (int)reader.GetInt64(11)));

    private static Task AuditAsync(UnitOfWork unitOfWork, OperatorContext caller, string action, Guid organizationId, object? data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(organizationId, "operator", caller.OperatorId, action, "organization", organizationId, caller.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);
}
