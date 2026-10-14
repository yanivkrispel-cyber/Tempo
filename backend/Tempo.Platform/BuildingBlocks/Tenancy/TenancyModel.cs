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

/// <summary>An account as the tenant filter needs it.</summary>
public sealed record AccountSnapshot(Guid UserAccountId, AccountStatus Status, bool EmailVerified);

/// <summary>A caller's membership in one studio, with the studio's status.</summary>
public sealed record MembershipSnapshot(Guid MembershipId, MembershipRole Role, MembershipStatus Status, OrganizationStatus OrganizationStatus);

/// <summary>One of the caller's live memberships with its studio, for GET /api/v1/me.</summary>
public sealed record AccountMembership(
    Guid MembershipId,
    MembershipRole Role,
    MembershipStatus Status,
    Guid OrganizationId,
    string Slug,
    string DisplayName,
    OrganizationStatus OrganizationStatus);

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
    string CorrelationId);

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
