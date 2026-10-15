namespace Tempo.Platform.BuildingBlocks.Tenancy;

/// <summary>The four fixed roles of Phase 1 (docs/26 section 4.1), stored as lowercase text.</summary>
public enum MembershipRole
{
    Owner,
    Admin,
    Staff,
    Client
}

public enum MembershipStatus
{
    Invited,
    Active,
    Suspended,
    Removed
}

public enum OrganizationStatus
{
    Active,
    Suspended
}

public enum AccountStatus
{
    Active,
    Disabled
}

/// <summary>Maps the stored lowercase text values to the enums and back.</summary>
public static class StoredValue
{
    public static T Parse<T>(string value)
        where T : struct, Enum =>
        Enum.Parse<T>(value, ignoreCase: true);

    public static string Of<T>(T value)
        where T : struct, Enum =>
        value.ToString().ToLowerInvariant();
}

/// <summary>An account as the tenant filter needs it. <paramref name="MfaEnabled"/> is as of the last sign-in.</summary>
public sealed record AccountSnapshot(Guid UserAccountId, AccountStatus Status, bool EmailVerified, bool MfaEnabled = false);

/// <summary>
/// A caller's membership in one studio, with the studio's status and the union
/// of the permissions of its live role assignments (docs/27 section 3.4).
/// <paramref name="Permissions"/> is null only where no database stands
/// behind the snapshot (tests); the system role's set applies then.
/// </summary>
public sealed record MembershipSnapshot(
    Guid MembershipId,
    MembershipRole Role,
    MembershipStatus Status,
    OrganizationStatus OrganizationStatus,
    IReadOnlySet<string>? Permissions = null)
{
    public IReadOnlySet<string> EffectivePermissions => Permissions ?? SystemRoles.Of(Role).Permissions;
}

/// <summary>
/// One of the caller's live memberships with its studio, for GET /api/v1/me.
/// Roles and permissions come from the role assignments; null means the
/// membership's system role (a membership just created in this transaction,
/// or a test).
/// </summary>
public sealed record AccountMembership(
    Guid MembershipId,
    MembershipRole Role,
    MembershipStatus Status,
    Guid OrganizationId,
    string Slug,
    string DisplayName,
    OrganizationStatus OrganizationStatus,
    IReadOnlyList<RoleSummary>? Roles = null,
    IReadOnlyCollection<string>? Permissions = null,
    PendingOwnershipTransfer? PendingOwnershipTransfer = null)
{
    public IReadOnlyList<RoleSummary> EffectiveRoles => Roles ?? [RoleSummary.Of(SystemRoles.Of(Role))];

    public IReadOnlyCollection<string> EffectivePermissions => Permissions ?? SystemRoles.Of(Role).Permissions;
}

/// <summary>
/// Built once per tenant request by the API's route filter (docs/26 section 6).
/// Repositories of tenant-owned tables take it as a required parameter.
/// </summary>
public sealed record TenantContext(
    Guid OrganizationId,
    Guid UserAccountId,
    Guid MembershipId,
    MembershipRole Role,
    OrganizationStatus OrganizationStatus,
    string CorrelationId,
    IReadOnlySet<string>? Permissions = null)
{
    /// <summary>The caller's permissions in this studio; the system role's set when none were loaded (tests).</summary>
    public IReadOnlySet<string> EffectivePermissions => Permissions ?? SystemRoles.Of(Role).Permissions;

    public bool Has(string permission) => EffectivePermissions.Contains(permission);
}

/// <summary>Finds the internal account linked to a token's issuer and subject. Implemented by the Identity module.</summary>
public interface IAccountDirectory
{
    Task<AccountSnapshot?> FindByExternalIdentityAsync(string issuer, string subject, CancellationToken cancellationToken);
}

/// <summary>Finds a caller's live membership in a studio. Implemented by the Organizations module.</summary>
public interface IMembershipDirectory
{
    Task<MembershipSnapshot?> FindAsync(Guid userAccountId, Guid organizationId, CancellationToken cancellationToken);

    /// <summary>Every membership of the account that is not removed, oldest first.</summary>
    Task<IReadOnlyList<AccountMembership>> ListForAccountAsync(Guid userAccountId, CancellationToken cancellationToken);
}

/// <summary>Name and email of an account, for member lists. Implemented by the Identity module.</summary>
public sealed record AccountProfile(Guid UserAccountId, string Email, string? DisplayName);

public interface IAccountProfiles
{
    Task<IReadOnlyDictionary<Guid, AccountProfile>> FindAsync(IReadOnlyCollection<Guid> userAccountIds, CancellationToken cancellationToken);
}

/// <summary>
/// The per-account limit on invitation and join attempts (docs/26 section
/// 10.3). Records the attempt and throws 429 when the account is over the limit.
/// </summary>
public interface IAttemptLimiter
{
    Task CheckAsync(Guid userAccountId, CancellationToken cancellationToken);
}

/// <summary>A Tempo team member on `/api/v1/platform/*` (docs/26 section 9).</summary>
public sealed record OperatorContext(Guid OperatorId, string Email, string CorrelationId);

/// <summary>
/// Finds the registered operator behind an operator-pool token. An operator
/// row is provisioned by a person with the Cognito `sub` (docs/claude-memory/
/// backend-patterns.md); a token with no active row gets 403.
/// </summary>
public interface IOperatorDirectory
{
    Task<(Guid OperatorId, string Email)?> FindActiveAsync(string issuer, string subject, CancellationToken cancellationToken);
}
