using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Security;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Domain;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Platform.Modules.Organizations.Application;

public sealed record JoinPreview(Guid OrganizationId, string DisplayName);

/// <summary>
/// The studio's join link for clients (docs/26 section 5.2). At most one
/// active code per studio, stored as a hash; rotating invalidates the old one
/// at once. Joining creates an active client membership (open question O-2).
/// </summary>
public interface IJoinLinkService
{
    /// <summary>Creates or replaces the join code. The code exists only in this response.</summary>
    Task<string> RotateAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task DisableAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<JoinPreview> PreviewAsync(AccountSnapshot caller, string code, CancellationToken cancellationToken);

    Task<AccountMembership> JoinAsync(AccountSnapshot caller, string code, string correlationId, CancellationToken cancellationToken);
}

public sealed class JoinLinkService(IDataSourceProvider dataSources, IAttemptLimiter limiter) : IJoinLinkService
{
    public const int CodeBytes = 16;

    public Task<string> RotateAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        var (code, hash) = SecretToken.New(CodeBytes);
        return SetAsync(tenant, hash, "join_link.rotated", code, cancellationToken);
    }

    public Task DisableAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        SetAsync(tenant, null, "join_link.disabled", string.Empty, cancellationToken);

    public async Task<JoinPreview> PreviewAsync(AccountSnapshot caller, string code, CancellationToken cancellationToken)
    {
        await limiter.CheckAsync(caller.UserAccountId, cancellationToken);
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, caller.UserAccountId, null, cancellationToken);
        var studio = await FindAsync(unitOfWork, code, cancellationToken);
        return studio is { Status: "active" }
            ? new JoinPreview(studio.Value.Id, studio.Value.DisplayName)
            : throw JoinNotFound();
    }

    public async Task<AccountMembership> JoinAsync(AccountSnapshot caller, string code, string correlationId, CancellationToken cancellationToken)
    {
        await limiter.CheckAsync(caller.UserAccountId, cancellationToken);
        if (!caller.EmailVerified)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "account.email_not_verified", "Verify your email first.");
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, caller.UserAccountId, null, cancellationToken);
        var studio = await FindAsync(unitOfWork, code, cancellationToken) ?? throw JoinNotFound();

        await unitOfWork.SetTenantAsync(caller.UserAccountId, studio.Id, cancellationToken);
        var (membership, created) = await MembershipQueries.JoinAsync(unitOfWork, studio.Id, caller.UserAccountId, MembershipRole.Client, cancellationToken);
        if (created)
        {
            await MembershipQueries.AuditAsync(unitOfWork, studio.Id, caller.UserAccountId, "membership.joined_via_link", "membership", membership.MembershipId, correlationId, new { role = "client" }, cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return membership;
    }

    private static DomainRuleViolationException JoinNotFound() =>
        new(ViolationKind.NotFound, "join.not_found", "This join link is not valid.");

    private async Task<string> SetAsync(TenantContext tenant, byte[]? hash, string action, string code, CancellationToken cancellationToken)
    {
        if (!RolePolicy.CanManageJoinLink(tenant.Role))
        {
            throw OrganizationService.Denied();
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
        await using (var command = unitOfWork.Command(
            "UPDATE organizations.organizations SET join_code_hash = $2, updated_at = now(), version = version + 1 WHERE id = $1",
            tenant.OrganizationId,
            hash))
        {
            command.Parameters[1].NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Bytea;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await MembershipQueries.AuditAsync(unitOfWork, tenant.OrganizationId, tenant.UserAccountId, action, "organization", tenant.OrganizationId, tenant.CorrelationId, null, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return code;
    }

    /// <summary>The SECURITY DEFINER lookup: works before any tenant is known.</summary>
    private static async Task<(Guid Id, string DisplayName, string Status)?> FindAsync(UnitOfWork unitOfWork, string code, CancellationToken cancellationToken)
    {
        if (code.Length is < 16 or > 64)
        {
            return null;
        }

        await using var command = unitOfWork.Command(
            "SELECT id, display_name, status FROM organizations.find_organization_by_join_code_hash($1)",
            SecretToken.Hash(code));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? (reader.GetGuid(0), reader.GetString(1), reader.GetString(2))
            : null;
    }
}
