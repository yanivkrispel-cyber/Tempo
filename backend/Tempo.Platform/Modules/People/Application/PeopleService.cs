using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Domain;

namespace Tempo.Platform.Modules.People.Application;

public sealed record PersonView(
    Guid Id,
    string DisplayName,
    string? GivenName,
    string? FamilyName,
    DateOnly? BirthDate,
    string Status,
    string Source,
    bool HasLogin,
    Guid? MembershipId,
    string? PrimaryEmail,
    string? PrimaryPhone,
    Guid? MergedIntoId,
    DateTimeOffset CreatedAt,
    long Version);

public sealed record ContactPointView(Guid Id, string Type, string Value, bool IsPrimary, bool Verified, long Version);

public sealed record ConsentView(
    Guid Id,
    string Purpose,
    string Channel,
    string State,
    string Method,
    string TextVersion,
    Guid? RecordedByMembershipId,
    DateTimeOffset OccurredAt);

public sealed record RelationshipView(Guid Id, string Type, Guid FromPersonId, Guid ToPersonId, string OtherDisplayName, DateTimeOffset CreatedAt);

public sealed record PersonDetailView(
    PersonView Person,
    IReadOnlyList<ContactPointView> ContactPoints,
    IReadOnlyList<ConsentView> Consents,
    IReadOnlyList<RelationshipView> Relationships);

public sealed record PersonPage(IReadOnlyList<PersonView> Items, Guid? NextBefore);

public sealed record PeopleQuery(string? Text, string? Status, Guid? Before, int Limit);

public sealed record NewPerson(string? DisplayName, string? GivenName, string? FamilyName, DateOnly? BirthDate, string? Email, string? Phone);

/// <summary>Changes to a person; a null field is left alone, <see cref="FieldChange{T}"/> distinguishes "clear".</summary>
public sealed record PersonChanges(
    string? DisplayName,
    FieldChange<string?> GivenName,
    FieldChange<string?> FamilyName,
    FieldChange<DateOnly?> BirthDate,
    string? Status);

/// <summary>A field in a PATCH body: <c>default</c> when absent, <see cref="FieldChange.Set{T}"/> when sent (null included).</summary>
public readonly record struct FieldChange<T>(bool IsSet, T Value);

public static class FieldChange
{
    public static FieldChange<T> Set<T>(T value) => new(true, value);
}

/// <summary>
/// A studio's person records (docs/27 sections 4.1, 4.2 and 4.6): people with
/// or without a login, their contact points, and duplicate candidates flagged
/// on create and on contact changes (never merged automatically). Route
/// permissions (`people.view`, `people.manage`) are checked by the API.
/// </summary>
public interface IPeopleService
{
    Task<PersonPage> ListAsync(TenantContext tenant, PeopleQuery query, CancellationToken cancellationToken);

    Task<PersonDetailView> GetAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);

    Task<PersonDetailView> CreateAsync(TenantContext tenant, NewPerson person, CancellationToken cancellationToken);

    Task<PersonDetailView> UpdateAsync(TenantContext tenant, Guid personId, PersonChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<ContactPointView> AddContactAsync(TenantContext tenant, Guid personId, string type, string value, bool isPrimary, CancellationToken cancellationToken);

    Task<ContactPointView> UpdateContactAsync(TenantContext tenant, Guid personId, Guid contactPointId, string? value, bool makePrimary, long? expectedVersion, CancellationToken cancellationToken);

    Task DeleteContactAsync(TenantContext tenant, Guid personId, Guid contactPointId, CancellationToken cancellationToken);
}

public sealed class PeopleService(IDataSourceProvider dataSources) : IPeopleService
{
    public const int MaxLimit = 100;

    private const string PersonColumns =
        """
        p.id, p.display_name, p.given_name, p.family_name, p.birth_date, p.status, p.source,
        p.user_account_id IS NOT NULL, p.membership_id,
        (SELECT c.value FROM people.contact_points c WHERE c.organization_id = p.organization_id AND c.person_id = p.id AND c.type = 'email' AND c.is_primary),
        (SELECT c.value FROM people.contact_points c WHERE c.organization_id = p.organization_id AND c.person_id = p.id AND c.type = 'phone' AND c.is_primary),
        p.merged_into_id, p.created_at, p.version
        """;

    public async Task<PersonPage> ListAsync(TenantContext tenant, PeopleQuery query, CancellationToken cancellationToken)
    {
        var limit = Math.Clamp(query.Limit, 1, MaxLimit);
        var text = PhoneLike(query.Text?.Trim());
        if (text is { Length: < 2 or > 100 })
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "query.length", "Search with 2 to 100 characters.", "query");
        }

        if (query.Status is not (null or "active" or "archived" or "anonymized" or "merged"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "status.invalid", "Unknown status.", "status");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command(
            $"""
            SELECT {PersonColumns}
            FROM people.people p
            WHERE p.organization_id = $1
              AND (($2::text IS NULL AND p.status IN ('active', 'archived')) OR p.status = $2)
              AND ($3::text IS NULL
                   OR p.display_name ILIKE '%' || $3 || '%'
                   OR EXISTS (SELECT 1 FROM people.contact_points c
                              WHERE c.organization_id = p.organization_id AND c.person_id = p.id
                                AND c.value ILIKE '%' || $3 || '%'))
              AND ($4::uuid IS NULL OR p.id < $4)
            ORDER BY p.id DESC
            LIMIT $5
            """,
            tenant.OrganizationId,
            query.Status,
            text is null ? null : EscapeLike(text),
            query.Before,
            limit + 1);
        var rows = await ReadPeopleAsync(command, cancellationToken);
        var page = rows.Take(limit).ToList();
        return new PersonPage(page, rows.Count > limit ? page[^1].Id : null);
    }

    public async Task<PersonDetailView> GetAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
    }

    public async Task<PersonDetailView> CreateAsync(TenantContext tenant, NewPerson person, CancellationToken cancellationToken)
    {
        var displayName = Name(person.DisplayName, "display_name") ?? throw Required("display_name");
        var email = string.IsNullOrWhiteSpace(person.Email) ? null : ContactValues.Email(person.Email);
        var phone = string.IsNullOrWhiteSpace(person.Phone) ? null : ContactValues.Phone(person.Phone);
        if (email is null && phone is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "contact.required", "Add a phone number or an email address.", "phone");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var personId = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO people.people (organization_id, id, given_name, family_name, display_name, birth_date, status, source, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'active', 'staff_created', now(), now())
            """,
            tenant.OrganizationId,
            personId,
            Name(person.GivenName, "given_name"),
            Name(person.FamilyName, "family_name"),
            displayName,
            person.BirthDate))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var (type, value) in new[] { ("email", email), ("phone", phone) })
        {
            if (value is not null)
            {
                await InsertContactAsync(unitOfWork, tenant.OrganizationId, personId, type, value, isPrimary: true, cancellationToken);
            }
        }

        await FlagDuplicatesAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "person.created", personId, new { source = "staff_created" }, cancellationToken);
        var created = await DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<PersonDetailView> UpdateAsync(TenantContext tenant, Guid personId, PersonChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (changes is { DisplayName: null, Status: null } && !changes.GivenName.IsSet && !changes.FamilyName.IsSet && !changes.BirthDate.IsSet)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.empty", "Nothing to update.");
        }

        if (changes.Status is not (null or "active" or "archived"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "status.invalid", "A person can be set active or archived.", "status");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = (await DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken, forUpdate: true)).Person;
        if (current.Status is "anonymized" or "merged")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "This record can no longer change.");
        }

        if (expectedVersion is { } expected && expected != current.Version)
        {
            throw Concurrency();
        }

        await using (var update = unitOfWork.Command(
            """
            UPDATE people.people
            SET display_name = $3, given_name = $4, family_name = $5, birth_date = $6, status = $7, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            """,
            tenant.OrganizationId,
            personId,
            changes.DisplayName is null ? current.DisplayName : Name(changes.DisplayName, "display_name") ?? throw Required("display_name"),
            changes.GivenName.IsSet ? Name(changes.GivenName.Value, "given_name") : current.GivenName,
            changes.FamilyName.IsSet ? Name(changes.FamilyName.Value, "family_name") : current.FamilyName,
            changes.BirthDate.IsSet ? changes.BirthDate.Value : current.BirthDate,
            changes.Status ?? current.Status))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        var changed = new List<string>();
        if (changes.DisplayName is not null) changed.Add("displayName");
        if (changes.GivenName.IsSet) changed.Add("givenName");
        if (changes.FamilyName.IsSet) changed.Add("familyName");
        if (changes.BirthDate.IsSet) changed.Add("birthDate");
        if (changes.Status is not null) changed.Add("status");
        await AuditAsync(unitOfWork, tenant, changes.Status == "archived" && current.Status != "archived" ? "person.archived" : "person.updated", personId, new { fields = changed }, cancellationToken);
        var updated = await DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<ContactPointView> AddContactAsync(TenantContext tenant, Guid personId, string type, string value, bool isPrimary, CancellationToken cancellationToken)
    {
        var normalized = ContactValues.Normalize(type, value);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockWritablePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);

        // The first contact of a type is primary whatever the caller asked.
        await using (var count = unitOfWork.Command(
            "SELECT count(*) FROM people.contact_points WHERE organization_id = $1 AND person_id = $2 AND type = $3",
            tenant.OrganizationId,
            personId,
            type))
        {
            isPrimary |= (long)(await count.ExecuteScalarAsync(cancellationToken))! == 0;
        }

        if (isPrimary)
        {
            await ClearPrimaryAsync(unitOfWork, tenant.OrganizationId, personId, type, cancellationToken);
        }

        var contactId = await InsertContactAsync(unitOfWork, tenant.OrganizationId, personId, type, normalized, isPrimary, cancellationToken);
        await FlagDuplicatesAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "person.updated", personId, new { fields = new[] { $"contact.{type}" } }, cancellationToken);
        var contact = (await ContactsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken)).Single(c => c.Id == contactId);
        await unitOfWork.CommitAsync(cancellationToken);
        return contact;
    }

    public async Task<ContactPointView> UpdateContactAsync(
        TenantContext tenant,
        Guid personId,
        Guid contactPointId,
        string? value,
        bool makePrimary,
        long? expectedVersion,
        CancellationToken cancellationToken)
    {
        if (value is null && !makePrimary)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.empty", "Nothing to update.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockWritablePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var contact = (await ContactsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken)).SingleOrDefault(c => c.Id == contactPointId)
            ?? throw ContactNotFound();
        if (expectedVersion is { } expected && expected != contact.Version)
        {
            throw Concurrency();
        }

        if (value is not null && contact.Verified)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "contact_point.verified", "The sign-in email changes only with the account.");
        }

        if (makePrimary)
        {
            await ClearPrimaryAsync(unitOfWork, tenant.OrganizationId, personId, contact.Type, cancellationToken);
        }

        await using (var update = unitOfWork.Command(
            """
            UPDATE people.contact_points
            SET value = $3, is_primary = $4, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            """,
            tenant.OrganizationId,
            contactPointId,
            value is null ? contact.Value : ContactValues.Normalize(contact.Type, value),
            makePrimary || contact.IsPrimary))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        if (value is not null)
        {
            await FlagDuplicatesAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "person.updated", personId, new { fields = new[] { $"contact.{contact.Type}" } }, cancellationToken);
        var updated = (await ContactsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken)).Single(c => c.Id == contactPointId);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task DeleteContactAsync(TenantContext tenant, Guid personId, Guid contactPointId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockWritablePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var contacts = await ContactsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var contact = contacts.SingleOrDefault(c => c.Id == contactPointId) ?? throw ContactNotFound();
        if (contact.Verified)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "contact_point.verified", "The sign-in email changes only with the account.");
        }

        await using (var delete = unitOfWork.Command("DELETE FROM people.contact_points WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, contactPointId))
        {
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        // Another contact of the same type takes over as primary.
        if (contact.IsPrimary && contacts.FirstOrDefault(c => c.Type == contact.Type && c.Id != contactPointId) is { } next)
        {
            await using var promote = unitOfWork.Command(
                "UPDATE people.contact_points SET is_primary = true, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId,
                next.Id);
            await promote.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "person.updated", personId, new { fields = new[] { $"contact.{contact.Type}" } }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Records a duplicate candidate for every other live person in the studio
    /// who shares a normalized email or phone, or the same name and birth date
    /// (section 4.6). Existing pairs are left as they are, resolved or not.
    /// </summary>
    internal static async Task FlagDuplicatesAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            WITH me AS (
                SELECT p.id, lower(p.display_name) AS name, p.birth_date
                FROM people.people p WHERE p.organization_id = $1 AND p.id = $2
            ),
            matches AS (
                SELECT DISTINCT ON (other.person_id) other.person_id AS other_id, mine.type AS reason
                FROM people.contact_points mine
                JOIN people.contact_points other
                  ON other.organization_id = mine.organization_id AND other.type = mine.type AND other.value = mine.value
                 AND other.person_id <> mine.person_id
                WHERE mine.organization_id = $1 AND mine.person_id = $2
                UNION
                SELECT p.id, 'name_birth_date'
                FROM people.people p, me
                WHERE p.organization_id = $1 AND p.id <> me.id AND me.birth_date IS NOT NULL
                  AND p.birth_date = me.birth_date AND lower(p.display_name) = me.name
            )
            INSERT INTO people.duplicate_candidates (organization_id, id, person_a_id, person_b_id, reason, status, created_at, updated_at)
            SELECT $1, uuidv7(), least($2, m.other_id), greatest($2, m.other_id), m.reason, 'open', now(), now()
            FROM matches m
            JOIN people.people other ON other.organization_id = $1 AND other.id = m.other_id AND other.status IN ('active', 'archived')
            ON CONFLICT (organization_id, person_a_id, person_b_id) DO NOTHING
            """,
            organizationId,
            personId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    internal static async Task<Guid> InsertContactAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, string type, string value, bool isPrimary, CancellationToken cancellationToken, bool verified = false)
    {
        var id = Guid.CreateVersion7();
        await using var insert = unitOfWork.Command(
            """
            INSERT INTO people.contact_points (organization_id, id, person_id, type, value, is_primary, verified, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
            """,
            organizationId,
            id,
            personId,
            type,
            value,
            isPrimary,
            verified);
        await insert.ExecuteNonQueryAsync(cancellationToken);
        return id;
    }

    internal static async Task<PersonDetailView> DetailAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken, bool forUpdate = false)
    {
        PersonView person;
        await using (var command = unitOfWork.Command(
            $"SELECT {PersonColumns} FROM people.people p WHERE p.organization_id = $1 AND p.id = $2{(forUpdate ? " FOR UPDATE OF p" : string.Empty)}",
            organizationId,
            personId))
        {
            person = (await ReadPeopleAsync(command, cancellationToken)).SingleOrDefault() ?? throw PersonNotFound();
        }

        var contacts = await ContactsAsync(unitOfWork, organizationId, personId, cancellationToken);

        var consents = new List<ConsentView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT DISTINCT ON (purpose, channel) id, purpose, channel, state, method, text_version, recorded_by, occurred_at
            FROM people.consents
            WHERE organization_id = $1 AND person_id = $2
            ORDER BY purpose, channel, occurred_at DESC, id DESC
            """,
            organizationId,
            personId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                consents.Add(await ReadConsentAsync(reader, cancellationToken));
            }
        }

        var relationships = new List<RelationshipView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT r.id, r.type, r.from_person_id, r.to_person_id, o.display_name, r.created_at
            FROM people.person_relationships r
            JOIN people.people o ON o.organization_id = r.organization_id
                                AND o.id = CASE WHEN r.from_person_id = $2 THEN r.to_person_id ELSE r.from_person_id END
            WHERE r.organization_id = $1 AND (r.from_person_id = $2 OR r.to_person_id = $2)
            ORDER BY r.created_at
            """,
            organizationId,
            personId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                relationships.Add(new RelationshipView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetGuid(2),
                    reader.GetGuid(3),
                    reader.GetString(4),
                    await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken)));
            }
        }

        return new PersonDetailView(person, contacts, consents, relationships);
    }

    internal static async Task<ConsentView> ReadConsentAsync(NpgsqlDataReader reader, CancellationToken cancellationToken) =>
        new(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetGuid(6),
            await reader.GetFieldValueAsync<DateTimeOffset>(7, cancellationToken));

    private static async Task<List<ContactPointView>> ContactsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        var contacts = new List<ContactPointView>();
        await using var command = unitOfWork.Command(
            """
            SELECT id, type, value, is_primary, verified, version
            FROM people.contact_points
            WHERE organization_id = $1 AND person_id = $2
            ORDER BY type, is_primary DESC, created_at
            """,
            organizationId,
            personId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            contacts.Add(new ContactPointView(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3), reader.GetBoolean(4), reader.GetInt64(5)));
        }

        return contacts;
    }

    private static async Task<List<PersonView>> ReadPeopleAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var people = new List<PersonView>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            people.Add(new PersonView(
                reader.GetGuid(0),
                reader.GetString(1),
                await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetString(2),
                await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetString(3),
                await reader.IsDBNullAsync(4, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(4, cancellationToken),
                reader.GetString(5),
                reader.GetString(6),
                reader.GetBoolean(7),
                await reader.IsDBNullAsync(8, cancellationToken) ? null : reader.GetGuid(8),
                await reader.IsDBNullAsync(9, cancellationToken) ? null : reader.GetString(9),
                await reader.IsDBNullAsync(10, cancellationToken) ? null : reader.GetString(10),
                await reader.IsDBNullAsync(11, cancellationToken) ? null : reader.GetGuid(11),
                await reader.GetFieldValueAsync<DateTimeOffset>(12, cancellationToken),
                reader.GetInt64(13)));
        }

        return people;
    }

    private static async Task LockWritablePersonAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT status FROM people.people WHERE organization_id = $1 AND id = $2 FOR UPDATE",
            organizationId,
            personId);
        var status = await command.ExecuteScalarAsync(cancellationToken) as string ?? throw PersonNotFound();
        if (status is "anonymized" or "merged")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "This record can no longer change.");
        }
    }

    private static async Task ClearPrimaryAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, string type, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "UPDATE people.contact_points SET is_primary = false, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $2 AND type = $3 AND is_primary",
            organizationId,
            personId,
            type);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string? Name(string? value, string field)
    {
        if (value is null)
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length switch
        {
            0 => null,
            > 100 => throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.length", "Names are up to 100 characters.", field),
            _ => trimmed
        };
    }

    /// <summary>
    /// A query typed like a phone number (`050-234 5678`) is searched in its stored E.164 form; anything else,
    /// or a partial number that does not parse, is searched as typed (review on #71).
    /// </summary>
    private static string? PhoneLike(string? text)
    {
        if (text is null || text.Length < 6 || !text.All(c => char.IsDigit(c) || c is '+' or '-' or ' ' or '(' or ')'))
        {
            return text;
        }

        try
        {
            return ContactValues.Phone(text);
        }
        catch (DomainRuleViolationException)
        {
            return new string([.. text.Where(char.IsDigit)]);
        }
    }

    private static string EscapeLike(string text) => text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static DomainRuleViolationException Required(string field) =>
        new(ViolationKind.Validation, $"{field}.required", "A display name is required.", field);

    private static DomainRuleViolationException Concurrency() =>
        new(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");

    internal static DomainRuleViolationException PersonNotFound() =>
        new(ViolationKind.NotFound, "person.not_found", "Person not found.");

    private static DomainRuleViolationException ContactNotFound() =>
        new(ViolationKind.NotFound, "contact_point.not_found", "Contact not found.");

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid personId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "person", personId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
