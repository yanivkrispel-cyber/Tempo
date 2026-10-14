using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Identity.Application;

/// <summary>The internal account (identity.user_accounts).</summary>
public sealed record AccountView(Guid Id, string Email, bool EmailVerified, string? DisplayName, string Locale, AccountStatus Status);

/// <summary>A Cognito sign-in as the API sees it: issuer, `sub`, and the Cognito username for AdminGetUser.</summary>
public sealed record SignIn(string Issuer, string Subject, string Username, DateTimeOffset? AuthTime, string CorrelationId);

/// <summary>What Cognito knows about the user. Access tokens carry no email, so it is read with AdminGetUser.</summary>
public sealed record CognitoUser(string Email, bool EmailVerified);

public interface ICognitoUserReader
{
    Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken);
}

/// <summary>Account routes of docs/26 section 8.1: session, me, update me.</summary>
public interface IAccountService
{
    /// <summary>
    /// Just-in-time provisioning (docs/26 section 2.3): returns the linked
    /// account, creating it on first use, and refreshes email and
    /// verification from Cognito when the sign-in is newer than the last sync.
    /// </summary>
    Task<AccountView> StartSessionAsync(SignIn signIn, CancellationToken cancellationToken);

    Task<AccountView?> FindAsync(string issuer, string subject, CancellationToken cancellationToken);

    Task<AccountView> UpdateAsync(Guid accountId, string? displayName, string? locale, CancellationToken cancellationToken);
}

public sealed class AccountService(IDataSourceProvider dataSources, ICognitoUserReader cognito) : IAccountService
{
    public static readonly IReadOnlySet<string> Locales = new HashSet<string>(StringComparer.Ordinal) { "he-IL", "en-US" };

    private const string UniqueViolation = "23505";

    private const string SelectByIdentity =
        """
        SELECT a.id, a.email, a.email_verified, a.display_name, a.locale, a.status, a.identity_synced_at
        FROM identity.external_identities e
        JOIN identity.user_accounts a ON a.id = e.user_account_id
        WHERE e.issuer = $1 AND e.subject = $2
        """;

    public async Task<AccountView> StartSessionAsync(SignIn signIn, CancellationToken cancellationToken)
    {
        var existing = await FindWithSyncTimeAsync(signIn.Issuer, signIn.Subject, cancellationToken);
        if (existing is not null)
        {
            var (account, syncedAt) = existing.Value;
            if (account.Status == AccountStatus.Disabled)
            {
                throw new DomainRuleViolationException(ViolationKind.Forbidden, "account.disabled", "This account is disabled.");
            }

            return signIn.AuthTime is { } authTime && authTime > syncedAt
                ? await RefreshAsync(account, signIn, cancellationToken)
                : account;
        }

        var user = await cognito.GetAsync(signIn.Issuer, signIn.Username, cancellationToken);
        try
        {
            return await CreateAsync(signIn, user, cancellationToken);
        }
        catch (PostgresException e) when (e.SqlState == UniqueViolation)
        {
            // Two first requests raced; the other one created the account.
            var raced = await FindWithSyncTimeAsync(signIn.Issuer, signIn.Subject, cancellationToken);
            return raced?.Account ?? throw new InvalidOperationException("The account vanished after a unique-key race.", e);
        }
    }

    public async Task<AccountView?> FindAsync(string issuer, string subject, CancellationToken cancellationToken) =>
        (await FindWithSyncTimeAsync(issuer, subject, cancellationToken))?.Account;

    public async Task<AccountView> UpdateAsync(Guid accountId, string? displayName, string? locale, CancellationToken cancellationToken)
    {
        displayName = displayName?.Trim();
        if (displayName is null && locale is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.empty", "Nothing to update.");
        }

        if (displayName is not null && displayName.Length is < 1 or > 100)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "display_name.length", "Use 1 to 100 characters.", "displayName");
        }

        if (locale is not null && !Locales.Contains(locale))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "locale.unsupported", "Unsupported language.", "locale");
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, accountId, null, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            UPDATE identity.user_accounts
            SET display_name = coalesce($2, display_name),
                locale = coalesce($3, locale),
                updated_at = now(),
                version = version + 1
            WHERE id = $1
            RETURNING id, email, email_verified, display_name, locale, status, identity_synced_at
            """,
            accountId,
            displayName,
            locale);
        var updated = await ReadOneAsync(command, cancellationToken)
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "account.not_provisioned", "Start a session first.");
        await unitOfWork.CommitAsync(cancellationToken);
        return updated.Account;
    }

    private async Task<AccountView> CreateAsync(SignIn signIn, CognitoUser user, CancellationToken cancellationToken)
    {
        var accountId = Guid.CreateVersion7();
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, accountId, null, cancellationToken);

        await using (var account = unitOfWork.Command(
            """
            INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at)
            VALUES ($1, 'active', $2, $3, now(), now(), now())
            """,
            accountId,
            user.Email,
            user.EmailVerified))
        {
            await account.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var identity = unitOfWork.Command(
            "INSERT INTO identity.external_identities (id, user_account_id, issuer, subject, created_at) VALUES ($1, $2, $3, $4, now())",
            Guid.CreateVersion7(),
            accountId,
            signIn.Issuer,
            signIn.Subject))
        {
            await identity.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(null, "user", accountId, "account.created", "user_account", accountId, signIn.CorrelationId),
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);

        return new AccountView(accountId, user.Email, user.EmailVerified, null, "he-IL", AccountStatus.Active);
    }

    private async Task<AccountView> RefreshAsync(AccountView account, SignIn signIn, CancellationToken cancellationToken)
    {
        var user = await cognito.GetAsync(signIn.Issuer, signIn.Username, cancellationToken);
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, account.Id, null, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            UPDATE identity.user_accounts
            SET email = $2, email_verified = $3, identity_synced_at = now(), updated_at = now(), version = version + 1
            WHERE id = $1
            """,
            account.Id,
            user.Email,
            user.EmailVerified);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return account with { Email = user.Email, EmailVerified = user.EmailVerified };
    }

    private async Task<(AccountView Account, DateTimeOffset SyncedAt)?> FindWithSyncTimeAsync(string issuer, string subject, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, null, cancellationToken);
        await using var command = unitOfWork.Command(SelectByIdentity, issuer, subject);
        return await ReadOneAsync(command, cancellationToken);
    }

    private static async Task<(AccountView Account, DateTimeOffset SyncedAt)?> ReadOneAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var account = new AccountView(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetBoolean(2),
            await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetString(3),
            reader.GetString(4),
            StoredValue.Parse<AccountStatus>(reader.GetString(5)));
        return (account, await reader.GetFieldValueAsync<DateTimeOffset>(6, cancellationToken));
    }
}
