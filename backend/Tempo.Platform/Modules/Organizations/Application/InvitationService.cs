using System.Text.RegularExpressions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Security;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Billing;
using Tempo.Platform.Modules.Organizations.Domain;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Platform.Modules.Organizations.Application;

/// <summary>`expired` is computed on read from a pending invitation past its expiry (docs/26 section 5.1).</summary>
public enum InvitationStatus
{
    Pending,
    Accepted,
    Revoked,
    Expired
}

public sealed record InvitationView(
    Guid Id,
    string Email,
    MembershipRole Role,
    InvitationStatus Status,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt,
    Guid InvitedByMembershipId,
    string? InvitedByDisplayName);

/// <summary>A new invitation and its token, which exists only in this response.</summary>
public sealed record CreatedInvitation(InvitationView Invitation, string Token);

public sealed record InvitationPreview(Guid OrganizationId, string OrganizationDisplayName, MembershipRole Role, string? InvitedByDisplayName, DateTimeOffset ExpiresAt);

public sealed record InvitationQuery(InvitationStatus? Status, Guid? Before, int Limit);

public sealed record InvitationPage(IReadOnlyList<InvitationView> Items, Guid? NextBefore);

/// <summary>Email-bound invitations (docs/26 sections 5.1 and 5.3).</summary>
public interface IInvitationService
{
    /// <summary><paramref name="personId"/>: the person record the invitation is for (POST /people/{id}/invite).</summary>
    Task<CreatedInvitation> CreateAsync(TenantContext tenant, string email, MembershipRole role, CancellationToken cancellationToken, Guid? personId = null);

    Task<InvitationPage> ListAsync(TenantContext tenant, InvitationQuery query, CancellationToken cancellationToken);

    Task RevokeAsync(TenantContext tenant, Guid invitationId, CancellationToken cancellationToken);

    Task<InvitationPreview> PreviewAsync(AccountSnapshot caller, string token, CancellationToken cancellationToken);

    Task<AccountMembership> AcceptAsync(AccountSnapshot caller, string token, string correlationId, CancellationToken cancellationToken);
}

public sealed partial class InvitationService(IDataSourceProvider dataSources, IAccountProfiles profiles, IAttemptLimiter limiter) : IInvitationService
{
    public const int TokenBytes = 32;
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    private const string Columns =
        """
        i.id, i.email, i.role,
        CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
        i.expires_at, i.created_at, i.invited_by_membership_id, m.user_account_id
        """;

    private sealed record Row(Guid Id, string Email, MembershipRole Role, InvitationStatus Status, DateTimeOffset ExpiresAt, DateTimeOffset CreatedAt, Guid InvitedBy, Guid InviterAccountId);

    public async Task<CreatedInvitation> CreateAsync(TenantContext tenant, string email, MembershipRole role, CancellationToken cancellationToken, Guid? personId = null)
    {
        if (!RolePolicy.CanInvite(tenant.Role, role))
        {
            throw OrganizationService.Denied();
        }

        email = email.Trim();
        if (email.Length > 254 || !EmailPattern().IsMatch(email))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "email.invalid", "Enter a valid email address.", "email");
        }

        var (token, hash) = SecretToken.New(TokenBytes);
        var invitationId = Guid.CreateVersion7();
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);

        if (role != MembershipRole.Client)
        {
            await BillingService.CheckLimitAsync(unitOfWork, tenant.OrganizationId, "staff.max", BillingService.StaffCountSql, cancellationToken);
        }

        // One pending invitation per email and studio: a new one replaces the old.
        var replaced = new List<Guid>();
        await using (var revoke = unitOfWork.Command(
            """
            UPDATE organizations.invitations
            SET status = 'revoked', updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND lower(email) = lower($2) AND status = 'pending'
            RETURNING id
            """,
            tenant.OrganizationId,
            email))
        {
            await using var reader = await revoke.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                replaced.Add(reader.GetGuid(0));
            }
        }

        foreach (var id in replaced)
        {
            await MembershipQueries.AuditAsync(unitOfWork, tenant.OrganizationId, tenant.UserAccountId, "invitation.revoked", "invitation", id, tenant.CorrelationId, new { reason = "replaced" }, cancellationToken);
        }

        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO organizations.invitations (organization_id, id, email, role, token_hash, status, expires_at, invited_by_membership_id, person_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', now() + $6, $7, $8::uuid, now(), now())
            """,
            tenant.OrganizationId,
            invitationId,
            email,
            StoredValue.Of(role),
            hash,
            Lifetime,
            tenant.MembershipId,
            personId))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        // Audit keeps ids only (docs/27 section 4.7): the email lives on the invitation row, which erase scrubs.
        await MembershipQueries.AuditAsync(unitOfWork, tenant.OrganizationId, tenant.UserAccountId, "invitation.created", "invitation", invitationId, tenant.CorrelationId, new { role = StoredValue.Of(role), personId }, cancellationToken);
        var created = (await ReadAsync(unitOfWork, tenant.OrganizationId, invitationId, cancellationToken))!;
        await unitOfWork.CommitAsync(cancellationToken);

        return new CreatedInvitation((await WithInvitersAsync([created], cancellationToken))[0], token);
    }

    public async Task<InvitationPage> ListAsync(TenantContext tenant, InvitationQuery query, CancellationToken cancellationToken)
    {
        if (!RolePolicy.CanManageInvitations(tenant.Role))
        {
            throw OrganizationService.Denied();
        }

        var limit = Math.Clamp(query.Limit, 1, MemberService.MaxLimit);
        var rows = new List<Row>();
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            await using var command = unitOfWork.Command(
                $"""
                SELECT * FROM (
                    SELECT {Columns}
                    FROM organizations.invitations i
                    JOIN organizations.memberships m ON m.organization_id = i.organization_id AND m.id = i.invited_by_membership_id
                    WHERE i.organization_id = $1 AND ($3::uuid IS NULL OR i.id < $3)
                ) AS listed (id, email, role, status, expires_at, created_at, invited_by, inviter)
                WHERE ($2::text IS NULL OR status = $2)
                ORDER BY id DESC
                LIMIT $4
                """,
                tenant.OrganizationId,
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
        return new InvitationPage(await WithInvitersAsync(page, cancellationToken), rows.Count > limit ? page[^1].Id : null);
    }

    public async Task RevokeAsync(TenantContext tenant, Guid invitationId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var invitation = await ReadAsync(unitOfWork, tenant.OrganizationId, invitationId, cancellationToken);
        if (invitation is null || invitation.Status is not (InvitationStatus.Pending or InvitationStatus.Expired))
        {
            throw InvitationNotFound();
        }

        if (!RolePolicy.CanManageInvitations(tenant.Role) || !RolePolicy.CanInvite(tenant.Role, invitation.Role))
        {
            throw OrganizationService.Denied();
        }

        await using (var revoke = unitOfWork.Command(
            "UPDATE organizations.invitations SET status = 'revoked', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId,
            invitationId))
        {
            await revoke.ExecuteNonQueryAsync(cancellationToken);
        }

        await MembershipQueries.AuditAsync(unitOfWork, tenant.OrganizationId, tenant.UserAccountId, "invitation.revoked", "invitation", invitationId, tenant.CorrelationId, new { reason = "revoked" }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    public async Task<InvitationPreview> PreviewAsync(AccountSnapshot caller, string token, CancellationToken cancellationToken)
    {
        await limiter.CheckAsync(caller.UserAccountId, cancellationToken);
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, caller.UserAccountId, null, cancellationToken);

        // Unknown, revoked, accepted and expired all answer the same, so a
        // token cannot be probed for its state (docs/26 section 8.5).
        var found = await FindByTokenAsync(unitOfWork, token, cancellationToken);
        if (found is null || found.Value.Status != "pending" || found.Value.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            throw InvitationNotFound();
        }

        var (organizationId, invitationId, _, _, _, _) = found.Value;
        await unitOfWork.SetTenantAsync(caller.UserAccountId, organizationId, cancellationToken);
        var invitation = (await ReadAsync(unitOfWork, organizationId, invitationId, cancellationToken))!;
        if (!await MembershipQueries.InviterStillMayInviteAsync(unitOfWork, organizationId, invitationId, cancellationToken))
        {
            throw InvitationNotFound();
        }

        string? studioName;
        await using (var studio = unitOfWork.Command("SELECT display_name FROM organizations.organizations WHERE id = $1 AND status = 'active'", organizationId))
        {
            studioName = await studio.ExecuteScalarAsync(cancellationToken) as string;
        }

        if (studioName is null)
        {
            throw InvitationNotFound();
        }

        var inviter = await profiles.FindAsync([invitation.InviterAccountId], cancellationToken);
        return new InvitationPreview(organizationId, studioName, invitation.Role, inviter.GetValueOrDefault(invitation.InviterAccountId)?.DisplayName, invitation.ExpiresAt);
    }

    public async Task<AccountMembership> AcceptAsync(AccountSnapshot caller, string token, string correlationId, CancellationToken cancellationToken)
    {
        await limiter.CheckAsync(caller.UserAccountId, cancellationToken);
        if (!caller.EmailVerified)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "account.email_not_verified", "Verify your email first.");
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, caller.UserAccountId, null, cancellationToken);
        var found = await FindByTokenAsync(unitOfWork, token, cancellationToken);
        if (found is null || found.Value.Status == "revoked")
        {
            throw InvitationNotFound();
        }

        var (organizationId, invitationId, email, role, status, expiresAt) = found.Value;
        var callerEmail = (await profiles.FindAsync([caller.UserAccountId], cancellationToken)).GetValueOrDefault(caller.UserAccountId)?.Email;
        if (!string.Equals(email, callerEmail, StringComparison.OrdinalIgnoreCase))
        {
            throw status == "pending"
                ? new DomainRuleViolationException(ViolationKind.Forbidden, "invitation.email_mismatch", "This invitation was sent to another email address.")
                : InvitationNotFound();
        }

        await unitOfWork.SetTenantAsync(caller.UserAccountId, organizationId, cancellationToken);

        if (status == "accepted")
        {
            // Accepting twice returns the same membership.
            return await MembershipQueries.FindLiveAsync(unitOfWork, organizationId, caller.UserAccountId, cancellationToken) ?? throw InvitationNotFound();
        }

        if (expiresAt <= DateTimeOffset.UtcNow)
        {
            throw new DomainRuleViolationException(ViolationKind.Gone, "invitation.expired", "This invitation has expired. Ask for a new one.");
        }

        // The inviter was removed, suspended or demoted after sending it (#121): the same answer as a revoked one.
        if (!await MembershipQueries.InviterStillMayInviteAsync(unitOfWork, organizationId, invitationId, cancellationToken))
        {
            throw InvitationNotFound();
        }

        Guid? personId;
        await using (var person = unitOfWork.Command("SELECT person_id FROM organizations.invitations WHERE organization_id = $1 AND id = $2", organizationId, invitationId))
        {
            personId = await person.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        var (membership, created) = await MembershipQueries.JoinAsync(unitOfWork, organizationId, caller.UserAccountId, StoredValue.Parse<MembershipRole>(role), cancellationToken, "invitation", personId);
        await using (var accept = unitOfWork.Command(
            """
            UPDATE organizations.invitations
            SET status = 'accepted', accepted_membership_id = $3, updated_at = now(), version = version + 1,
                -- An invitation sent by email alone points at the person it created or found, so erase reaches it (#101).
                person_id = coalesce(person_id, (SELECT p.id FROM people.people p WHERE p.organization_id = $1 AND p.membership_id = $3))
            WHERE organization_id = $1 AND id = $2
            """,
            organizationId,
            invitationId,
            membership.MembershipId))
        {
            await accept.ExecuteNonQueryAsync(cancellationToken);
        }

        if (created)
        {
            await MembershipQueries.AuditAsync(unitOfWork, organizationId, caller.UserAccountId, "membership.created", "membership", membership.MembershipId, correlationId, new { role, via = "invitation" }, cancellationToken);
        }

        await MembershipQueries.AuditAsync(unitOfWork, organizationId, caller.UserAccountId, "invitation.accepted", "invitation", invitationId, correlationId, null, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return membership;
    }

    private static DomainRuleViolationException InvitationNotFound() =>
        new(ViolationKind.NotFound, "invitation.not_found", "This invitation is not valid.");

    /// <summary>The SECURITY DEFINER lookup: works before any tenant is known and returns only the matching row.</summary>
    private static async Task<(Guid OrganizationId, Guid Id, string Email, string Role, string Status, DateTimeOffset ExpiresAt)?> FindByTokenAsync(
        UnitOfWork unitOfWork,
        string token,
        CancellationToken cancellationToken)
    {
        if (token.Length is < 20 or > 100)
        {
            return null;
        }

        await using var command = unitOfWork.Command(
            "SELECT organization_id, id, email, role, status, expires_at FROM organizations.find_invitation_by_token_hash($1)",
            SecretToken.Hash(token));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return (reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken));
    }

    private static async Task<Row?> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, Guid invitationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            $"""
            SELECT {Columns}
            FROM organizations.invitations i
            JOIN organizations.memberships m ON m.organization_id = i.organization_id AND m.id = i.invited_by_membership_id
            WHERE i.organization_id = $1 AND i.id = $2
            """,
            organizationId,
            invitationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? await ReadRowAsync(reader, cancellationToken) : null;
    }

    private static async Task<Row> ReadRowAsync(NpgsqlDataReader reader, CancellationToken cancellationToken) =>
        new(
            reader.GetGuid(0),
            reader.GetString(1),
            StoredValue.Parse<MembershipRole>(reader.GetString(2)),
            StoredValue.Parse<InvitationStatus>(reader.GetString(3)),
            await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
            await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken),
            reader.GetGuid(6),
            reader.GetGuid(7));

    private async Task<List<InvitationView>> WithInvitersAsync(List<Row> rows, CancellationToken cancellationToken)
    {
        var inviters = await profiles.FindAsync([.. rows.Select(r => r.InviterAccountId).Distinct()], cancellationToken);
        return
        [
            .. rows.Select(r => new InvitationView(
                r.Id,
                r.Email,
                r.Role,
                r.Status,
                r.ExpiresAt,
                r.CreatedAt,
                r.InvitedBy,
                inviters.GetValueOrDefault(r.InviterAccountId)?.DisplayName))
        ];
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();
}
