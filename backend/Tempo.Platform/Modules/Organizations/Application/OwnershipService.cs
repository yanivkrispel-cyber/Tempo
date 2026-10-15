using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Platform.Modules.Organizations.Application;

public enum OwnershipTransferStatus
{
    Pending,
    Accepted,
    Declined,
    Cancelled,
    Expired
}

public sealed record OwnershipTransferView(
    Guid Id,
    OwnershipTransferStatus Status,
    Guid FromMembershipId,
    Guid ToMembershipId,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt);

/// <summary>
/// Owner transfer (docs/27 section 3.5): the owner offers the studio to an
/// active admin, who accepts within 72 hours. On acceptance, in one
/// transaction, the target becomes owner and the old owner admin, both in
/// `memberships.role` and in the role assignments. Step-up is the API's job.
/// </summary>
public interface IOwnershipService
{
    Task<OwnershipTransferView> GetPendingAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<OwnershipTransferView> StartAsync(TenantContext tenant, Guid toMembershipId, CancellationToken cancellationToken);

    Task CancelAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task AcceptAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task DeclineAsync(TenantContext tenant, CancellationToken cancellationToken);
}

public sealed class OwnershipService(IDataSourceProvider dataSources, TimeProvider clock) : IOwnershipService
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(72);

    private const string Columns = "id, status, from_membership_id, to_membership_id, expires_at, created_at";

    public async Task<OwnershipTransferView> GetPendingAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var pending = await FindPendingAsync(unitOfWork, tenant.OrganizationId, forUpdate: false, cancellationToken);
        if (pending is null || !IsParty(tenant, pending) || IsExpired(pending))
        {
            throw NotFound();
        }

        return pending;
    }

    public async Task<OwnershipTransferView> StartAsync(TenantContext tenant, Guid toMembershipId, CancellationToken cancellationToken)
    {
        if (tenant.Role != MembershipRole.Owner)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only the owner can hand over the studio.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await ExpireStaleAsync(unitOfWork, tenant.OrganizationId, cancellationToken);

        await using (var target = unitOfWork.Command(
            "SELECT role, status FROM organizations.memberships WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId,
            toMembershipId))
        await using (var reader = await target.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "membership.not_found", "Member not found.");
            }

            if (reader.GetString(0) != "admin" || reader.GetString(1) != "active")
            {
                throw new DomainRuleViolationException(ViolationKind.Forbidden, "ownership.target_not_admin", "The studio can go only to an active admin.");
            }
        }

        var now = clock.GetUtcNow();
        OwnershipTransferView created;
        try
        {
            await using var insert = unitOfWork.Command(
                $"""
                INSERT INTO organizations.ownership_transfers
                    (organization_id, id, from_membership_id, to_membership_id, status, expires_at, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'pending', $5, $6, $6)
                RETURNING {Columns}
                """,
                tenant.OrganizationId,
                Guid.CreateVersion7(),
                tenant.MembershipId,
                toMembershipId,
                now + Lifetime,
                now);
            created = (await ReadAsync(insert, cancellationToken))!;
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == "ux_ownership_transfers_one_pending")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "ownership.transfer_pending", "A transfer is already waiting for an answer.");
        }

        await AuditAsync(unitOfWork, tenant, "ownership.transfer_started", created.Id, new { to = toMembershipId }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task CancelAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var pending = await FindPendingAsync(unitOfWork, tenant.OrganizationId, forUpdate: true, cancellationToken);
        if (pending is null || pending.FromMembershipId != tenant.MembershipId || IsExpired(pending))
        {
            throw NotFound();
        }

        await SetStatusAsync(unitOfWork, tenant.OrganizationId, pending.Id, OwnershipTransferStatus.Cancelled, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "ownership.transfer_cancelled", pending.Id, new { to = pending.ToMembershipId }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    public async Task AcceptAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var pending = await FindPendingAsync(unitOfWork, tenant.OrganizationId, forUpdate: true, cancellationToken);
        if (pending is null || pending.ToMembershipId != tenant.MembershipId)
        {
            throw NotFound();
        }

        if (IsExpired(pending))
        {
            await SetStatusAsync(unitOfWork, tenant.OrganizationId, pending.Id, OwnershipTransferStatus.Expired, cancellationToken);
            await unitOfWork.CommitAsync(cancellationToken);
            throw new DomainRuleViolationException(ViolationKind.Gone, "ownership.transfer_expired", "This offer has expired.");
        }

        await HandOverAsync(unitOfWork, tenant.OrganizationId, pending.FromMembershipId, pending.ToMembershipId, tenant.MembershipId, cancellationToken);
        await SetStatusAsync(unitOfWork, tenant.OrganizationId, pending.Id, OwnershipTransferStatus.Accepted, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "ownership.transferred", pending.Id, new { from = pending.FromMembershipId, to = pending.ToMembershipId }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    public async Task DeclineAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var pending = await FindPendingAsync(unitOfWork, tenant.OrganizationId, forUpdate: true, cancellationToken);
        if (pending is null || pending.ToMembershipId != tenant.MembershipId || IsExpired(pending))
        {
            throw NotFound();
        }

        await SetStatusAsync(unitOfWork, tenant.OrganizationId, pending.Id, OwnershipTransferStatus.Declined, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "ownership.transfer_declined", pending.Id, new { from = pending.FromMembershipId }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Swaps owner and admin. The old owner steps down first, because both
    /// `ux_memberships_one_owner` and `ux_role_assignments_one_owner` allow one
    /// live owner per studio at any moment. Shared with the operators' forced transfer.
    /// </summary>
    public static async Task HandOverAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid fromMembershipId,
        Guid toMembershipId,
        Guid? grantedByMembershipId,
        CancellationToken cancellationToken)
    {
        foreach (var (membershipId, role) in new[] { (fromMembershipId, MembershipRole.Admin), (toMembershipId, MembershipRole.Owner) })
        {
            await using (var update = unitOfWork.Command(
                "UPDATE organizations.memberships SET role = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                organizationId,
                membershipId,
                StoredValue.Of(role)))
            {
                await update.ExecuteNonQueryAsync(cancellationToken);
            }

            await RoleAssignments.SetSystemRoleAsync(unitOfWork, organizationId, membershipId, role, grantedByMembershipId, cancellationToken);
        }
    }

    private bool IsExpired(OwnershipTransferView transfer) => transfer.ExpiresAt <= clock.GetUtcNow();

    private static bool IsParty(TenantContext tenant, OwnershipTransferView transfer) =>
        transfer.FromMembershipId == tenant.MembershipId || transfer.ToMembershipId == tenant.MembershipId;

    private async Task ExpireStaleAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var expire = unitOfWork.Command(
            "UPDATE organizations.ownership_transfers SET status = 'expired', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND status = 'pending' AND expires_at <= $2",
            organizationId,
            clock.GetUtcNow());
        await expire.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<OwnershipTransferView?> FindPendingAsync(UnitOfWork unitOfWork, Guid organizationId, bool forUpdate, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            $"SELECT {Columns} FROM organizations.ownership_transfers WHERE organization_id = $1 AND status = 'pending'{(forUpdate ? " FOR UPDATE" : string.Empty)}",
            organizationId);
        return await ReadAsync(command, cancellationToken);
    }

    private static async Task SetStatusAsync(UnitOfWork unitOfWork, Guid organizationId, Guid transferId, OwnershipTransferStatus status, CancellationToken cancellationToken)
    {
        await using var update = unitOfWork.Command(
            "UPDATE organizations.ownership_transfers SET status = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            organizationId,
            transferId,
            StoredValue.Of(status));
        await update.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<OwnershipTransferView?> ReadAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new OwnershipTransferView(
            reader.GetGuid(0),
            StoredValue.Parse<OwnershipTransferStatus>(reader.GetString(1)),
            reader.GetGuid(2),
            reader.GetGuid(3),
            await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
            await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken));
    }

    private static DomainRuleViolationException NotFound() =>
        new(ViolationKind.NotFound, "ownership.transfer_not_found", "No transfer is waiting.");

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid transferId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "ownership_transfer", transferId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
