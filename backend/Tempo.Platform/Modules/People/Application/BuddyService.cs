using System.Security.Cryptography;
using System.Text;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.People.Application;

/// <summary>A one-time buddy code, shown once; <paramref name="Code"/> is formatted for reading ("ABCD-EFGH").</summary>
public sealed record BuddyCodeView(string Code, DateTimeOffset ExpiresAt);

public sealed record BuddyView(Guid PersonId, string DisplayName, DateTimeOffset Since);

/// <summary>
/// Buddies by mutual consent (docs/33 section 4, D18): a member shares a one-time code, another member of the same
/// studio enters it, and from then on each sees where the other booked on the room map. Either side ends it. There
/// is no search and no list of members: knowing the code is the consent of the one who shared it.
/// </summary>
public interface IBuddyService
{
    Task<BuddyCodeView> NewCodeAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<BuddyView> LinkAsync(TenantContext tenant, string? code, CancellationToken cancellationToken);

    Task<IReadOnlyList<BuddyView>> ListAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task UnlinkAsync(TenantContext tenant, Guid buddyPersonId, CancellationToken cancellationToken);
}

public sealed class BuddyService(IDataSourceProvider dataSources, TimeProvider clock) : IBuddyService
{
    /// <summary>No 0/O or 1/I, so a code read aloud or copied by hand survives.</summary>
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private const int CodeLength = 8;
    private const int MaxBuddies = 20;
    private const int MaxWrongCodesPerHour = 5;
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromHours(48);

    public async Task<BuddyCodeView> NewCodeAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var me = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        var code = RandomNumberGenerator.GetString(Alphabet, CodeLength);
        var expiresAt = clock.GetUtcNow().Add(CodeLifetime);
        await using (var upsert = unitOfWork.Command(
            """
            INSERT INTO people.buddy_codes (organization_id, person_id, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (organization_id, person_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, created_at = now()
            """,
            tenant.OrganizationId, me, Hash(code), expiresAt))
        {
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return new BuddyCodeView($"{code[..4]}-{code[4..]}", expiresAt);
    }

    public async Task<BuddyView> LinkAsync(TenantContext tenant, string? code, CancellationToken cancellationToken)
    {
        var normalized = new string((code ?? "").Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());
        if (normalized.Length != CodeLength)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "buddy.invalid_code", "A buddy code has 8 letters and digits.", "code");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var me = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        var now = clock.GetUtcNow();
        await using (var attempts = unitOfWork.Command(
            "SELECT count(*)::int FROM people.buddy_attempts WHERE organization_id = $1 AND person_id = $2 AND attempted_at > $3",
            tenant.OrganizationId, me, now.AddHours(-1)))
        {
            if ((int)(await attempts.ExecuteScalarAsync(cancellationToken))! >= MaxWrongCodesPerHour)
            {
                throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "buddy.too_many_attempts", "Too many wrong codes. Try again in an hour.");
            }
        }

        Guid? owner;
        await using (var find = unitOfWork.Command(
            """
            SELECT c.person_id FROM people.buddy_codes c
            JOIN people.people p ON p.organization_id = c.organization_id AND p.id = c.person_id AND p.status = 'active'
            WHERE c.organization_id = $1 AND c.code_hash = $2 AND c.expires_at > $3
            """,
            tenant.OrganizationId, Hash(normalized), now))
        {
            owner = await find.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        if (owner is not { } buddy)
        {
            // A wrong guess is recorded in its own transaction, so the 404 below can't roll it back.
            await RecordWrongCodeAsync(tenant, me, now, cancellationToken);
            throw new DomainRuleViolationException(ViolationKind.NotFound, "buddy.invalid_code", "This code is wrong or has expired.");
        }

        if (buddy == me)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "buddy.self", "This is your own code; share it with a friend.");
        }

        await using (var count = unitOfWork.Command(
            "SELECT count(*)::int FROM people.buddy_links WHERE organization_id = $1 AND (person_low = $2 OR person_high = $2 OR person_low = $3 OR person_high = $3)",
            tenant.OrganizationId, me, buddy))
        {
            if ((int)(await count.ExecuteScalarAsync(cancellationToken))! >= MaxBuddies)
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "buddy.limit", $"A member has at most {MaxBuddies} buddies.");
            }
        }

        var (low, high) = me.CompareTo(buddy) < 0 ? (me, buddy) : (buddy, me);
        await using (var link = unitOfWork.Command(
            "INSERT INTO people.buddy_links (organization_id, person_low, person_high, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
            tenant.OrganizationId, low, high))
        {
            await link.ExecuteNonQueryAsync(cancellationToken);
        }

        // One use: the code is gone once it linked two people.
        await using (var used = unitOfWork.Command("DELETE FROM people.buddy_codes WHERE organization_id = $1 AND person_id = $2", tenant.OrganizationId, buddy))
        {
            await used.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "buddy.linked", me, new { buddyPersonId = buddy }, cancellationToken);
        var view = (await ReadAsync(unitOfWork, tenant.OrganizationId, me, cancellationToken)).Single(b => b.PersonId == buddy);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    public async Task<IReadOnlyList<BuddyView>> ListAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadAsync(unitOfWork, tenant.OrganizationId, await MyPersonIdAsync(unitOfWork, tenant, cancellationToken), cancellationToken);
    }

    public async Task UnlinkAsync(TenantContext tenant, Guid buddyPersonId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var me = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        var (low, high) = me.CompareTo(buddyPersonId) < 0 ? (me, buddyPersonId) : (buddyPersonId, me);
        await using (var delete = unitOfWork.Command(
            "DELETE FROM people.buddy_links WHERE organization_id = $1 AND person_low = $2 AND person_high = $3",
            tenant.OrganizationId, low, high))
        {
            if (await delete.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "buddy.not_found", "Not your buddy.");
            }
        }

        await AuditAsync(unitOfWork, tenant, "buddy.unlinked", me, new { buddyPersonId }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    /// <summary>The ids of <paramref name="personId"/>'s buddies, for the room map.</summary>
    public static async Task<HashSet<Guid>> BuddyIdsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT CASE WHEN person_low = $2 THEN person_high ELSE person_low END
            FROM people.buddy_links WHERE organization_id = $1 AND (person_low = $2 OR person_high = $2)
            """,
            organizationId, personId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var ids = new HashSet<Guid>();
        while (await reader.ReadAsync(cancellationToken))
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    /// <summary>Erase (docs/27) and merge remove every buddy row of the person.</summary>
    public static async Task ForgetAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        foreach (var sql in new[]
        {
            "DELETE FROM people.buddy_codes WHERE organization_id = $1 AND person_id = $2",
            "DELETE FROM people.buddy_attempts WHERE organization_id = $1 AND person_id = $2",
            "DELETE FROM people.buddy_links WHERE organization_id = $1 AND (person_low = $2 OR person_high = $2)"
        })
        {
            await using var command = unitOfWork.Command(sql, organizationId, personId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task<List<BuddyView>> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, Guid me, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT p.id, p.display_name, l.created_at
            FROM people.buddy_links l
            JOIN people.people p ON p.organization_id = l.organization_id AND p.id = CASE WHEN l.person_low = $2 THEN l.person_high ELSE l.person_low END
            WHERE l.organization_id = $1 AND (l.person_low = $2 OR l.person_high = $2) AND p.status = 'active'
            ORDER BY p.display_name, p.id
            """,
            organizationId, me);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var buddies = new List<BuddyView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            buddies.Add(new BuddyView(reader.GetGuid(0), reader.GetString(1), await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken)));
        }

        return buddies;
    }

    private async Task RecordWrongCodeAsync(TenantContext tenant, Guid me, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var record = unitOfWork.Command(
            "INSERT INTO people.buddy_attempts (organization_id, person_id, attempted_at) VALUES ($1, $2, $3)",
            tenant.OrganizationId, me, now))
        {
            await record.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var prune = unitOfWork.Command(
            "DELETE FROM people.buddy_attempts WHERE organization_id = $1 AND person_id = $2 AND attempted_at < $3",
            tenant.OrganizationId, me, now.AddDays(-1)))
        {
            await prune.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static byte[] Hash(string code) => SHA256.HashData(Encoding.ASCII.GetBytes(code));

    private static async Task<Guid> MyPersonIdAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2 AND status = 'active'",
            tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid id
            ? id
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Your record in this studio was not found.");
    }

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid personId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "person", personId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
