using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Identity.Application;

/// <summary>Deletes a user from the customer pool (Cognito AdminDeleteUser on that one pool).</summary>
public interface ICognitoUserDeleter
{
    Task DeleteAsync(string issuer, string username, CancellationToken cancellationToken);
}

/// <summary>A person deletes their own login (docs/32 section 9, A-1 and A-2).</summary>
public interface IAccountDeletionService
{
    /// <summary>
    /// Ends every membership, removes the account and detaches each studio's person record, in one transaction.
    /// The API deletes the Cognito user after it returns. 400 `account.confirmation_mismatch`, 404 `account.not_provisioned`,
    /// 409 `account.sole_owner` with `organizationIds`.
    /// </summary>
    Task DeleteMineAsync(SignIn signIn, string? confirmEmail, CancellationToken cancellationToken);
}

public sealed class AccountDeletionService(IDataSourceProvider dataSources) : IAccountDeletionService
{
    public async Task DeleteMineAsync(SignIn signIn, string? confirmEmail, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        var (accountId, email) = await FindAsync(unitOfWork, signIn, cancellationToken);
        if (!string.Equals(confirmEmail?.Trim(), email, StringComparison.OrdinalIgnoreCase))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "account.confirmation_mismatch", "Type your account's email to confirm.", "confirmEmail");
        }

        // As the account, memberships_app and people_app_select show its own rows in every studio.
        await AsAccountAsync(unitOfWork, accountId, cancellationToken);

        var memberships = new List<(Guid OrganizationId, Guid Id, string Role, string Status)>();
        await using (var command = unitOfWork.Command(
            "SELECT organization_id, id, role, status FROM organizations.memberships WHERE user_account_id = $1 ORDER BY organization_id, id FOR UPDATE",
            accountId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                memberships.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3)));
            }
        }

        // One owner per studio (ux_memberships_one_owner), so a live owner membership is the studio's only owner.
        var soleOwner = memberships.Where(m => m.Role == "owner" && m.Status != "removed").Select(m => m.OrganizationId).Distinct().ToList();
        if (soleOwner.Count > 0)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "account.sole_owner", "Transfer ownership of your studio before deleting your account.")
            {
                Extensions = new Dictionary<string, object?> { ["organizationIds"] = soleOwner }
            };
        }

        var studios = memberships.Select(m => m.OrganizationId).ToHashSet();
        await using (var command = unitOfWork.Command("SELECT DISTINCT organization_id FROM people.people WHERE user_account_id = $1", accountId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                studios.Add(reader.GetGuid(0));
            }
        }

        foreach (var organizationId in studios.Order())
        {
            await unitOfWork.SetTenantAsync(accountId, organizationId, cancellationToken);
            var ids = memberships.Where(m => m.OrganizationId == organizationId).Select(m => m.Id).ToArray();
            await ExecuteAsync(
                unitOfWork,
                """
                UPDATE organizations.ownership_transfers SET status = 'cancelled', updated_at = now(), version = version + 1
                WHERE organization_id = $1 AND status = 'pending' AND (from_membership_id = ANY($2) OR to_membership_id = ANY($2))
                """,
                cancellationToken,
                organizationId,
                ids);
            await ExecuteAsync(
                unitOfWork,
                """
                UPDATE organizations.memberships SET status = 'removed', updated_at = now(), version = version + 1
                WHERE organization_id = $1 AND user_account_id = $2 AND status <> 'removed'
                """,
                cancellationToken,
                organizationId,
                accountId);

            // A push subscription is this login's device; the person record and its inbox stay with the studio.
            await ExecuteAsync(
                unitOfWork,
                """
                DELETE FROM notifications.push_subscriptions s
                USING people.people p
                WHERE s.organization_id = $1 AND p.organization_id = s.organization_id AND p.id = s.person_id AND p.user_account_id = $2
                """,
                cancellationToken,
                organizationId,
                accountId);
            await AuditWriter.WriteAsync(unitOfWork, new AuditEvent(organizationId, "user", accountId, "account.deleted", "user_account", accountId, signIn.CorrelationId), cancellationToken);
        }

        // The foreign keys of migration 0022 clear the account from memberships, people and the studios it created,
        // and delete its sign-in links and join attempts.
        await AsAccountAsync(unitOfWork, accountId, cancellationToken);
        await ExecuteAsync(unitOfWork, "DELETE FROM identity.user_accounts WHERE id = $1", cancellationToken, accountId);
        await AuditWriter.WriteAsync(unitOfWork, new AuditEvent(null, "user", accountId, "account.deleted", "user_account", accountId, signIn.CorrelationId, new { studios = studios.Count }), cancellationToken);

        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static async Task<(Guid Id, string Email)> FindAsync(UnitOfWork unitOfWork, SignIn signIn, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT a.id, a.email
            FROM identity.external_identities e
            JOIN identity.user_accounts a ON a.id = e.user_account_id
            WHERE e.issuer = $1 AND e.subject = $2
            FOR UPDATE OF a
            """,
            signIn.Issuer,
            signIn.Subject);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? (reader.GetGuid(0), reader.GetString(1))
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "account.not_provisioned", "Start a session first.");
    }

    /// <summary>The account with no studio, the way account routes run.</summary>
    private static Task AsAccountAsync(UnitOfWork unitOfWork, Guid accountId, CancellationToken cancellationToken) =>
        ExecuteAsync(unitOfWork, "SELECT set_config('app.user_account_id', $1, true), set_config('app.organization_id', '', true)", cancellationToken, accountId.ToString());

    private static async Task ExecuteAsync(UnitOfWork unitOfWork, string sql, CancellationToken cancellationToken, params object?[] parameters)
    {
        await using var command = unitOfWork.Command(sql, parameters);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
