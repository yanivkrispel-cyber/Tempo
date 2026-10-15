using System.Text.RegularExpressions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Organizations.Domain;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Platform.Modules.Organizations.Application;

public sealed record OrganizationView(
    Guid Id,
    string Slug,
    string DisplayName,
    OrganizationStatus Status,
    string CountryCode,
    string DefaultLocale,
    string TimeZone,
    string CurrencyCode,
    bool JoinLinkEnabled,
    DateTimeOffset CreatedAt,
    long Version);

public sealed record NewOrganization(string DisplayName, string Slug, string? TimeZone, string? DefaultLocale);

public sealed record OrganizationChanges(string? DisplayName, string? TimeZone, string? DefaultLocale);

/// <summary>Studios: create (docs/26 section 3.2), read and change settings (section 8.2).</summary>
public interface IOrganizationService
{
    Task<OrganizationView> CreateAsync(AccountSnapshot caller, NewOrganization request, string correlationId, CancellationToken cancellationToken);

    Task<OrganizationView> GetAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<OrganizationView> UpdateAsync(TenantContext tenant, OrganizationChanges changes, long? expectedVersion, CancellationToken cancellationToken);
}

public sealed partial class OrganizationService(IDataSourceProvider dataSources) : IOrganizationService
{
    /// <summary>Phase 1 abuse limit (docs/26 sections 3.2 and 10.3).</summary>
    public const int CreationLimit = 3;

    public static readonly IReadOnlySet<string> Locales = new HashSet<string>(StringComparer.Ordinal) { "he-IL", "en-US" };

    private const string Columns =
        "id, slug, display_name, status, country_code, default_locale, time_zone, currency_code, join_code_hash IS NOT NULL, created_at, version";

    public async Task<OrganizationView> CreateAsync(AccountSnapshot caller, NewOrganization request, string correlationId, CancellationToken cancellationToken)
    {
        if (!caller.EmailVerified)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "account.email_not_verified", "Verify your email first.");
        }

        var displayName = ValidDisplayName(request.DisplayName);
        if (request.Slug is null || !SlugPattern().IsMatch(request.Slug))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "slug.invalid", "Use 3 to 40 lowercase letters, digits and hyphens.", "slug");
        }

        var timeZone = ValidTimeZone(request.TimeZone ?? "Asia/Jerusalem");
        var locale = ValidLocale(request.DefaultLocale ?? "he-IL", "defaultLocale");

        var organizationId = Guid.CreateVersion7();
        var membershipId = Guid.CreateVersion7();
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, caller.UserAccountId, organizationId, cancellationToken);

        // One creation at a time per account, so two parallel requests cannot
        // both pass the limit check.
        await using (var lockCommand = unitOfWork.Command("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", $"organization-create:{caller.UserAccountId}"))
        {
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var count = unitOfWork.Command("SELECT count(*) FROM organizations.organizations WHERE created_by_user_id = $1", caller.UserAccountId))
        {
            if ((long)(await count.ExecuteScalarAsync(cancellationToken))! >= CreationLimit)
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "organization.creation_limit", $"An account can open at most {CreationLimit} studios.");
            }
        }

        OrganizationView created;
        try
        {
            await using var insert = unitOfWork.Command(
                $"""
                INSERT INTO organizations.organizations (id, slug, display_name, status, default_locale, time_zone, created_by_user_id, created_at, updated_at)
                VALUES ($1, $2, $3, 'active', $4, $5, $6, now(), now())
                RETURNING {Columns}
                """,
                organizationId,
                request.Slug,
                displayName,
                locale,
                timeZone,
                caller.UserAccountId);
            created = (await ReadOneAsync(insert, cancellationToken))!;
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == "organizations_slug_key")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "organization.slug_taken", "That address is taken.", "slug");
        }

        await using (var owner = unitOfWork.Command(
            """
            INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at)
            VALUES ($1, $2, $3, 'owner', 'active', now(), now())
            """,
            organizationId,
            membershipId,
            caller.UserAccountId))
        {
            await owner.ExecuteNonQueryAsync(cancellationToken);
        }

        await RoleAssignments.SetSystemRoleAsync(unitOfWork, organizationId, membershipId, MembershipRole.Owner, null, cancellationToken);
        await PersonLinks.EnsureForMembershipAsync(unitOfWork, organizationId, membershipId, caller.UserAccountId, "organization_created", cancellationToken);

        await AuditWriter.WriteAsync(unitOfWork, new AuditEvent(organizationId, "user", caller.UserAccountId, "organization.created", "organization", organizationId, correlationId, new { slug = request.Slug, displayName }), cancellationToken);
        await AuditWriter.WriteAsync(unitOfWork, new AuditEvent(organizationId, "user", caller.UserAccountId, "membership.created", "membership", membershipId, correlationId, new { role = "owner" }), cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<OrganizationView> GetAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command($"SELECT {Columns} FROM organizations.organizations WHERE id = $1", tenant.OrganizationId);
        return await ReadOneAsync(command, cancellationToken) ?? throw NotFound();
    }

    public async Task<OrganizationView> UpdateAsync(TenantContext tenant, OrganizationChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (!RolePolicy.CanEditOrganization(tenant.Role))
        {
            throw Denied();
        }

        if (changes.DisplayName is null && changes.TimeZone is null && changes.DefaultLocale is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.empty", "Nothing to update.");
        }

        var displayName = changes.DisplayName is null ? null : ValidDisplayName(changes.DisplayName);
        var timeZone = changes.TimeZone is null ? null : ValidTimeZone(changes.TimeZone);
        var locale = changes.DefaultLocale is null ? null : ValidLocale(changes.DefaultLocale, "defaultLocale");

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        OrganizationView before;
        await using (var read = unitOfWork.Command($"SELECT {Columns} FROM organizations.organizations WHERE id = $1 FOR UPDATE", tenant.OrganizationId))
        {
            before = await ReadOneAsync(read, cancellationToken) ?? throw NotFound();
        }

        if (expectedVersion is { } expected && expected != before.Version)
        {
            throw Concurrency();
        }

        OrganizationView after;
        await using (var update = unitOfWork.Command(
            $"""
            UPDATE organizations.organizations
            SET display_name = coalesce($2, display_name),
                time_zone = coalesce($3, time_zone),
                default_locale = coalesce($4, default_locale),
                updated_at = now(),
                version = version + 1
            WHERE id = $1
            RETURNING {Columns}
            """,
            tenant.OrganizationId,
            displayName,
            timeZone,
            locale))
        {
            after = (await ReadOneAsync(update, cancellationToken))!;
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(
                tenant.OrganizationId,
                "user",
                tenant.UserAccountId,
                "organization.updated",
                "organization",
                tenant.OrganizationId,
                tenant.CorrelationId,
                new
                {
                    before = new { before.DisplayName, before.TimeZone, before.DefaultLocale },
                    after = new { after.DisplayName, after.TimeZone, after.DefaultLocale }
                }),
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    internal static DomainRuleViolationException Denied() =>
        new(ViolationKind.Forbidden, "permission.denied", "Your role in this studio does not allow this.");

    internal static DomainRuleViolationException Concurrency() =>
        new(ViolationKind.Conflict, "concurrency.conflict", "Someone else changed this first. Reload and try again.");

    private static DomainRuleViolationException NotFound() =>
        new(ViolationKind.NotFound, "organization.not_found", "Studio not found.");

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);

    private static string ValidDisplayName(string? value)
    {
        var trimmed = value?.Trim();
        return trimmed is { Length: >= 2 and <= 100 }
            ? trimmed
            : throw new DomainRuleViolationException(ViolationKind.Validation, "display_name.length", "Use 2 to 100 characters.", "displayName");
    }

    private static string ValidTimeZone(string value) =>
        TimeZoneInfo.TryFindSystemTimeZoneById(value, out _)
            ? value
            : throw new DomainRuleViolationException(ViolationKind.Validation, "time_zone.unknown", "Unknown time zone.", "timeZone");

    private static string ValidLocale(string value, string field) =>
        Locales.Contains(value)
            ? value
            : throw new DomainRuleViolationException(ViolationKind.Validation, "locale.unsupported", "Unsupported language.", field);

    private static async Task<OrganizationView?> ReadOneAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new OrganizationView(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            StoredValue.Parse<OrganizationStatus>(reader.GetString(3)),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetString(7),
            reader.GetBoolean(8),
            await reader.GetFieldValueAsync<DateTimeOffset>(9, cancellationToken),
            reader.GetInt64(10));
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")]
    private static partial Regex SlugPattern();
}
