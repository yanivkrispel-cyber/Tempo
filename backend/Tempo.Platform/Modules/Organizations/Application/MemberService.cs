using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Billing;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Organizations.Domain;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Platform.Modules.Organizations.Application;

public sealed record MemberView(
    Guid Id,
    Guid UserAccountId,
    string Email,
    string? DisplayName,
    MembershipRole Role,
    MembershipStatus Status,
    DateTimeOffset JoinedAt,
    long Version,
    Guid? PersonId = null);

/// <summary>A members page: newest first, keyset on the membership id (UUID v7, so time-ordered).</summary>
public sealed record MemberQuery(MembershipRole? Role, MembershipStatus? Status, Guid? Before, int Limit);

public sealed record MemberPage(IReadOnlyList<MemberView> Items, Guid? NextBefore);

/// <summary>Members of a studio (docs/26 sections 4 and 8.2).</summary>
public interface IMemberService
{
    Task<MemberPage> ListAsync(TenantContext tenant, MemberQuery query, CancellationToken cancellationToken);

    Task<MemberView> UpdateAsync(TenantContext tenant, Guid membershipId, MembershipRole? role, MembershipStatus? status, long? expectedVersion, CancellationToken cancellationToken);

    /// <summary>Removes a member, or leaves the studio when it is the caller's own membership.</summary>
    Task RemoveAsync(TenantContext tenant, Guid membershipId, CancellationToken cancellationToken);
}

public sealed class MemberService(IDataSourceProvider dataSources, IAccountProfiles profiles) : IMemberService
{
    public const int MaxLimit = 100;

    private sealed record Row(Guid Id, Guid UserAccountId, MembershipRole Role, MembershipStatus Status, DateTimeOffset CreatedAt, long Version, Guid? PersonId = null);

    public async Task<MemberPage> ListAsync(TenantContext tenant, MemberQuery query, CancellationToken cancellationToken)
    {
        if (!RolePolicy.CanListMembers(tenant.Role))
        {
            throw OrganizationService.Denied();
        }

        var limit = Math.Clamp(query.Limit, 1, MaxLimit);
        var rows = new List<Row>();
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            // Removed members show only when asked for by status.
            await using var command = unitOfWork.Command(
                """
                SELECT m.id, m.user_account_id, m.role, m.status, m.created_at, m.version, p.id
                FROM organizations.memberships m
                LEFT JOIN people.people p ON p.organization_id = m.organization_id AND p.membership_id = m.id
                WHERE m.organization_id = $1
                  AND ($2::text IS NULL OR m.role = $2)
                  AND (($3::text IS NULL AND m.status <> 'removed') OR m.status = $3)
                  AND ($4::uuid IS NULL OR m.id < $4)
                ORDER BY m.id DESC
                LIMIT $5
                """,
                tenant.OrganizationId,
                query.Role is { } role ? StoredValue.Of(role) : null,
                query.Status is { } status ? StoredValue.Of(status) : null,
                query.Before,
                limit + 1);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(await ReadRowAsync(reader, cancellationToken));
            }
        }

        var page = rows.Take(limit).ToList();
        var items = await WithProfilesAsync(page, cancellationToken);
        return new MemberPage(items, rows.Count > limit ? page[^1].Id : null);
    }

    public async Task<MemberView> UpdateAsync(
        TenantContext tenant,
        Guid membershipId,
        MembershipRole? role,
        MembershipStatus? status,
        long? expectedVersion,
        CancellationToken cancellationToken)
    {
        if (role is null && status is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.empty", "Nothing to update.");
        }

        if (status is not (null or MembershipStatus.Active or MembershipStatus.Suspended))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "status.invalid", "A member can be set active or suspended.", "status");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var target = await LockAsync(unitOfWork, tenant, membershipId, cancellationToken);

        if (!RolePolicy.CanChangeMember(tenant.Role, target.Id == tenant.MembershipId, target.Role, role))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "membership.forbidden_role_change", "You cannot change this member.");
        }

        if (expectedVersion is { } expected && expected != target.Version)
        {
            throw OrganizationService.Concurrency();
        }

        var newRole = role ?? target.Role;
        var newStatus = status ?? target.Status;
        if (target.Role == MembershipRole.Client && newRole != MembershipRole.Client)
        {
            await BillingService.CheckLimitAsync(unitOfWork, tenant.OrganizationId, "staff.max", BillingService.StaffCountSql, cancellationToken);
        }

        Row updated;
        await using (var command = unitOfWork.Command(
            """
            UPDATE organizations.memberships
            SET role = $3, status = $4, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            RETURNING id, user_account_id, role, status, created_at, version
            """,
            tenant.OrganizationId,
            membershipId,
            StoredValue.Of(newRole),
            StoredValue.Of(newStatus)))
        {
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            updated = await ReadRowAsync(reader, cancellationToken);
        }

        if (newRole != target.Role)
        {
            await RoleAssignments.SetSystemRoleAsync(unitOfWork, tenant.OrganizationId, membershipId, newRole, tenant.MembershipId, cancellationToken);
            await AuditAsync(unitOfWork, tenant, "membership.role_changed", membershipId, new { before = StoredValue.Of(target.Role), after = StoredValue.Of(newRole) }, cancellationToken);
        }

        if (newStatus != target.Status)
        {
            var action = newStatus == MembershipStatus.Suspended ? "membership.suspended" : "membership.reactivated";
            await AuditAsync(unitOfWork, tenant, action, membershipId, new { before = StoredValue.Of(target.Status), after = StoredValue.Of(newStatus) }, cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return (await WithProfilesAsync([updated], cancellationToken))[0];
    }

    public async Task RemoveAsync(TenantContext tenant, Guid membershipId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var target = await LockAsync(unitOfWork, tenant, membershipId, cancellationToken);
        var isSelf = target.Id == tenant.MembershipId;

        if (isSelf && target.Role == MembershipRole.Owner)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "membership.owner_cannot_leave", "The owner cannot leave the studio.");
        }

        if (!RolePolicy.CanRemoveMember(tenant.Role, isSelf, target.Role))
        {
            throw OrganizationService.Denied();
        }

        await using (var command = unitOfWork.Command(
            "UPDATE organizations.memberships SET status = 'removed', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId,
            membershipId))
        {
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await RoleAssignments.RevokeAllAsync(unitOfWork, tenant.OrganizationId, membershipId, cancellationToken);
        await PersonLinks.UnlinkMembershipAsync(unitOfWork, tenant.OrganizationId, membershipId, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "membership.removed", membershipId, new { role = StoredValue.Of(target.Role), left = isSelf }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static async Task<Row> LockAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid membershipId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT id, user_account_id, role, status, created_at, version
            FROM organizations.memberships
            WHERE organization_id = $1 AND id = $2 AND status <> 'removed'
            FOR UPDATE
            """,
            tenant.OrganizationId,
            membershipId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? await ReadRowAsync(reader, cancellationToken)
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "membership.not_found", "Member not found.");
    }

    private async Task<List<MemberView>> WithProfilesAsync(List<Row> rows, CancellationToken cancellationToken)
    {
        var found = await profiles.FindAsync([.. rows.Select(r => r.UserAccountId).Distinct()], cancellationToken);
        return
        [
            .. rows.Select(r =>
            {
                var profile = found.GetValueOrDefault(r.UserAccountId);
                return new MemberView(r.Id, r.UserAccountId, profile?.Email ?? string.Empty, profile?.DisplayName, r.Role, r.Status, r.CreatedAt, r.Version, r.PersonId);
            })
        ];
    }

    private static async Task<Row> ReadRowAsync(Npgsql.NpgsqlDataReader reader, CancellationToken cancellationToken) =>
        new(
            reader.GetGuid(0),
            reader.GetGuid(1),
            StoredValue.Parse<MembershipRole>(reader.GetString(2)),
            StoredValue.Parse<MembershipStatus>(reader.GetString(3)),
            await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
            reader.GetInt64(5),
            reader.FieldCount > 6 && !await reader.IsDBNullAsync(6, cancellationToken) ? reader.GetGuid(6) : null);

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid membershipId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "membership", membershipId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
