using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Domain;

namespace Tempo.Platform.Modules.People.Application;

/// <summary>One row of the file, as the console read it: cells trimmed, nothing normalized yet.</summary>
public sealed record ImportRowInput(
    int Line,
    string? DisplayName,
    string? GivenName,
    string? FamilyName,
    string? Phone,
    string? Email,
    string? BirthDate);

/// <summary>What became of one row (docs/34 section 4).</summary>
public sealed record ImportRowOutcome(
    int Line,
    string Outcome,
    Guid? PersonId = null,
    int? DuplicateOfLine = null,
    bool PossibleDuplicate = false,
    string? Field = null,
    string? Code = null);

public sealed record ImportTotals(int Rows, int Valid, int Created, int Exists, int DuplicateInFile, int Invalid);

public sealed record ImportResult(bool DryRun, Guid? ImportId, ImportTotals Totals, IReadOnlyList<ImportRowOutcome> Rows);

/// <summary>
/// Member import from a file (docs/34 sections 4 to 6). The console reads the CSV and sends its rows; this service
/// checks every row, finds the ones already in the studio, and on a commit creates the rest in one transaction with a
/// fixed number of set-based statements. It never changes an existing person, records no consent and sends nothing.
/// The route permission (`people.import`) is checked by the API.
/// </summary>
public interface IPeopleImportService
{
    Task<ImportResult> ImportAsync(TenantContext tenant, bool dryRun, IReadOnlyList<ImportRowInput> rows, CancellationToken cancellationToken, Guid? tagId = null);
}

public sealed class PeopleImportService(IDataSourceProvider dataSources, TimeProvider clock) : IPeopleImportService
{
    public const int MaxRows = 1000;

    public static class Outcomes
    {
        public const string Valid = "valid";
        public const string Created = "created";
        public const string Exists = "exists";
        public const string DuplicateInFile = "duplicate_in_file";
        public const string Invalid = "invalid";
    }

    private static readonly string[] BirthDateFormats = ["d/M/yyyy", "d.M.yyyy", "yyyy-MM-dd"];

    private sealed record CheckedRow(int Index, int Line, string DisplayName, string? GivenName, string? FamilyName, string? Phone, string? Email, DateOnly? BirthDate);

    public async Task<ImportResult> ImportAsync(TenantContext tenant, bool dryRun, IReadOnlyList<ImportRowInput> rows, CancellationToken cancellationToken, Guid? tagId = null)
    {
        if (rows.Count == 0 || rows.Count > MaxRows)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "import.too_many_rows", $"An import holds 1 to {MaxRows} rows. Split the file.", "rows");
        }

        var outcomes = new ImportRowOutcome?[rows.Count];
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        // 1. Each row on its own (section 4); 2. repeats inside the file.
        var good = new List<CheckedRow>();
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            if (Check(i, row, today, out var failure) is not { } valid)
            {
                outcomes[i] = failure;
                continue;
            }

            var keys = Keys(valid).ToList();
            var earlier = keys.Select(k => seen.TryGetValue(k, out var line) ? line : (int?)null).FirstOrDefault(l => l is not null);
            if (earlier is { } earlierLine)
            {
                outcomes[i] = new ImportRowOutcome(row.Line, Outcomes.DuplicateInFile, DuplicateOfLine: earlierLine);
                continue;
            }

            foreach (var key in keys)
            {
                seen[key] = row.Line;
            }

            good.Add(valid);
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);

        // Two imports into one studio at once would both miss each other's people; the second waits for the first.
        await using (var lockStudio = unitOfWork.Command("SELECT pg_advisory_xact_lock(hashtextextended('people.import:' || $1::text, 0))", tenant.OrganizationId))
        {
            await lockStudio.ExecuteNonQueryAsync(cancellationToken);
        }

        // The batch tag (I-8) must be one of this studio's tags, on a dry run too.
        if (tagId is { } tag)
        {
            await using var findTag = unitOfWork.Command("SELECT 1 FROM people.tags WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, tag);
            if (await findTag.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "tag.not_found", "Tag not found.", "tagId");
            }
        }

        // 3. Matches in the studio, in one query.
        var existing = await ExistingAsync(unitOfWork, tenant.OrganizationId, good, cancellationToken);
        var toCreate = new List<CheckedRow>();
        foreach (var row in good)
        {
            var match = Keys(row).Select(k => existing.TryGetValue(k, out var id) ? id : (Guid?)null).FirstOrDefault(id => id is not null);
            if (match is { } personId)
            {
                outcomes[row.Index] = new ImportRowOutcome(row.Line, Outcomes.Exists, personId);
            }
            else
            {
                toCreate.Add(row);
            }
        }

        // Name and birth date: flagged, never merged (I-5), against the studio and against the other new rows.
        var possible = await PossibleDuplicatesAsync(unitOfWork, tenant.OrganizationId, toCreate, cancellationToken);

        Guid? importId = null;
        var ids = toCreate.ToDictionary(r => r.Index, _ => Guid.CreateVersion7());
        if (!dryRun && toCreate.Count > 0)
        {
            importId = Guid.CreateVersion7();
            await CreateAsync(unitOfWork, tenant, importId.Value, toCreate, ids, tagId, cancellationToken);
        }

        foreach (var row in toCreate)
        {
            outcomes[row.Index] = new ImportRowOutcome(
                row.Line,
                dryRun ? Outcomes.Valid : Outcomes.Created,
                dryRun ? null : ids[row.Index],
                PossibleDuplicate: possible.Contains(row.Index));
        }

        var result = outcomes.Select(o => o!).ToList();
        var totals = new ImportTotals(
            rows.Count,
            toCreate.Count,
            dryRun ? 0 : toCreate.Count,
            result.Count(o => o.Outcome == Outcomes.Exists),
            result.Count(o => o.Outcome == Outcomes.DuplicateInFile),
            result.Count(o => o.Outcome == Outcomes.Invalid));

        if (!dryRun && importId is { } id)
        {
            await AuditWriter.WriteAsync(
                unitOfWork,
                new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "people.imported", "organization", tenant.OrganizationId, tenant.CorrelationId,
                    new { importId = id, rows = totals.Rows, created = totals.Created, exists = totals.Exists, duplicateInFile = totals.DuplicateInFile, invalid = totals.Invalid, tagged = tagId is null ? 0 : totals.Created }),
                cancellationToken);
            await unitOfWork.CommitAsync(cancellationToken);
        }

        return new ImportResult(dryRun, importId, totals, result);
    }

    /// <summary>Section 4, in order; the first failure wins.</summary>
    private static CheckedRow? Check(int index, ImportRowInput row, DateOnly today, out ImportRowOutcome? failure)
    {
        failure = null;
        ImportRowOutcome Invalid(string field, string code) => new(row.Line, Outcomes.Invalid, Field: field, Code: code);

        var given = Clean(row.GivenName);
        var family = Clean(row.FamilyName);
        var display = Clean(row.DisplayName) ?? Clean(string.Join(' ', new[] { given, family }.Where(s => s is not null)));
        if (display is null)
        {
            failure = Invalid("display_name", "required");
            return null;
        }

        if (display.Length > 100 || given?.Length > 100 || family?.Length > 100)
        {
            failure = Invalid("display_name", "too_long");
            return null;
        }

        string? phone = null;
        if (Clean(row.Phone) is { } rawPhone)
        {
            try
            {
                phone = ContactValues.Phone(rawPhone);
            }
            catch (DomainRuleViolationException)
            {
                failure = Invalid("phone", "phone.invalid");
                return null;
            }
        }

        string? email = null;
        if (Clean(row.Email) is { } rawEmail)
        {
            try
            {
                email = ContactValues.Email(rawEmail);
            }
            catch (DomainRuleViolationException)
            {
                failure = Invalid("email", "email.invalid");
                return null;
            }
        }

        if (phone is null && email is null)
        {
            failure = Invalid("contact", "contact.required");
            return null;
        }

        DateOnly? birthDate = null;
        if (Clean(row.BirthDate) is { } rawDate)
        {
            if (!DateOnly.TryParseExact(rawDate, BirthDateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
                || parsed > today || parsed < new DateOnly(1900, 1, 1))
            {
                failure = Invalid("birth_date", "birth_date.invalid");
                return null;
            }

            birthDate = parsed;
        }

        return new CheckedRow(index, row.Line, display, given, family, phone, email, birthDate);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static IEnumerable<string> Keys(CheckedRow row)
    {
        if (row.Email is not null)
        {
            yield return "email:" + row.Email;
        }

        if (row.Phone is not null)
        {
            yield return "phone:" + row.Phone;
        }
    }

    private static async Task<Dictionary<string, Guid>> ExistingAsync(UnitOfWork unitOfWork, Guid organizationId, List<CheckedRow> rows, CancellationToken cancellationToken)
    {
        var found = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var keys = rows.SelectMany(Keys).ToArray();
        if (keys.Length == 0)
        {
            return found;
        }

        await using var command = unitOfWork.Command(
            """
            SELECT DISTINCT ON (cp.type, cp.value) cp.type, cp.value, cp.person_id
            FROM unnest($2::text[], $3::text[]) AS v(type, value)
            JOIN people.contact_points cp ON cp.organization_id = $1 AND cp.type = v.type AND cp.value = v.value
            ORDER BY cp.type, cp.value, cp.person_id
            """,
            organizationId,
            keys.Select(k => k[..k.IndexOf(':')]).ToArray(),
            keys.Select(k => k[(k.IndexOf(':') + 1)..]).ToArray());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            found[reader.GetString(0) + ":" + reader.GetString(1)] = reader.GetGuid(2);
        }

        return found;
    }

    private static async Task<HashSet<int>> PossibleDuplicatesAsync(UnitOfWork unitOfWork, Guid organizationId, List<CheckedRow> rows, CancellationToken cancellationToken)
    {
        var flagged = new HashSet<int>();
        var dated = rows.Where(r => r.BirthDate is not null).ToList();
        if (dated.Count == 0)
        {
            return flagged;
        }

        // Within the file.
        foreach (var group in dated.GroupBy(r => (Name: r.DisplayName.ToLowerInvariant(), r.BirthDate)).Where(g => g.Count() > 1))
        {
            flagged.UnionWith(group.Select(r => r.Index));
        }

        // Against the studio's live people.
        await using var command = unitOfWork.Command(
            """
            SELECT DISTINCT lower(p.display_name), p.birth_date
            FROM people.people p
            JOIN unnest($2::text[], $3::date[]) AS v(name, birth_date) ON lower(p.display_name) = v.name AND p.birth_date = v.birth_date
            WHERE p.organization_id = $1 AND p.status IN ('active', 'archived')
            """,
            organizationId,
            dated.Select(r => r.DisplayName.ToLowerInvariant()).ToArray(),
            dated.Select(r => r.BirthDate!.Value).ToArray());
        var matches = new HashSet<(string, DateOnly)>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                matches.Add((reader.GetString(0), await reader.GetFieldValueAsync<DateOnly>(1, cancellationToken)));
            }
        }

        flagged.UnionWith(dated.Where(r => matches.Contains((r.DisplayName.ToLowerInvariant(), r.BirthDate!.Value))).Select(r => r.Index));
        return flagged;
    }

    /// <summary>Section 5 steps 5 to 7: a fixed number of statements, whatever the number of rows.</summary>
    private static async Task CreateAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid importId, List<CheckedRow> rows, Dictionary<int, Guid> ids, Guid? tagId, CancellationToken cancellationToken)
    {
        var org = tenant.OrganizationId;
        var personIds = rows.Select(r => ids[r.Index]).ToArray();

        await ExecuteAsync(
            unitOfWork,
            """
            INSERT INTO people.people (organization_id, id, given_name, family_name, display_name, birth_date, status, source, created_at, updated_at)
            SELECT $1, r.id, r.given_name, r.family_name, r.display_name, r.birth_date, 'active', 'import', now(), now()
            FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::date[]) AS r(id, given_name, family_name, display_name, birth_date)
            """,
            cancellationToken,
            org,
            personIds,
            rows.Select(r => r.GivenName).ToArray(),
            rows.Select(r => r.FamilyName).ToArray(),
            rows.Select(r => r.DisplayName).ToArray(),
            rows.Select(r => r.BirthDate).ToArray());

        var contacts = rows
            .SelectMany(r => new[] { (Id: ids[r.Index], Type: "email", Value: r.Email), (Id: ids[r.Index], Type: "phone", Value: r.Phone) })
            .Where(c => c.Value is not null)
            .ToList();
        await ExecuteAsync(
            unitOfWork,
            """
            INSERT INTO people.contact_points (organization_id, id, person_id, type, value, is_primary, verified, created_at, updated_at)
            SELECT $1, uuidv7(), c.person_id, c.type, c.value, true, false, now(), now()
            FROM unnest($2::uuid[], $3::text[], $4::text[]) AS c(person_id, type, value)
            """,
            cancellationToken,
            org,
            contacts.Select(c => c.Id).ToArray(),
            contacts.Select(c => c.Type).ToArray(),
            contacts.Select(c => c.Value!).ToArray());

        // The batch tag on every created person (I-8); a new person has no other tag, so the per-person limit holds.
        if (tagId is { } tag)
        {
            await ExecuteAsync(
                unitOfWork,
                """
                INSERT INTO people.person_tags (organization_id, person_id, tag_id, created_at)
                SELECT $1, p.id, $2, now() FROM unnest($3::uuid[]) AS p(id)
                """,
                cancellationToken,
                org,
                tag,
                personIds);
        }

        // Name and birth date against every other live person, the other new ones included (docs/27 section 4.6).
        await ExecuteAsync(
            unitOfWork,
            """
            INSERT INTO people.duplicate_candidates (organization_id, id, person_a_id, person_b_id, reason, status, created_at, updated_at)
            SELECT $1, uuidv7(), pair.a, pair.b, 'name_birth_date', 'open', now(), now()
            FROM (
                SELECT DISTINCT least(n.id, o.id) AS a, greatest(n.id, o.id) AS b
                FROM people.people n
                JOIN people.people o
                  ON o.organization_id = n.organization_id AND o.id <> n.id
                 AND o.birth_date = n.birth_date AND lower(o.display_name) = lower(n.display_name)
                 AND o.status IN ('active', 'archived')
                WHERE n.organization_id = $1 AND n.id = ANY($2::uuid[]) AND n.birth_date IS NOT NULL
            ) pair
            ON CONFLICT (organization_id, person_a_id, person_b_id) DO NOTHING
            """,
            cancellationToken,
            org,
            personIds);

        // One `person.created` per person, as createPerson writes it, with no name, email or phone (I-7).
        await using var audit = unitOfWork.Command(
            """
            INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, target_id, correlation_id, data)
            SELECT uuidv7(), $1, now(), 'user', $2, 'person.created', 'person', t.id, $3, jsonb_build_object('source', 'import', 'importId', $4::uuid)
            FROM unnest($5::uuid[]) AS t(id)
            """,
            org,
            tenant.UserAccountId,
            tenant.CorrelationId,
            importId,
            personIds);
        await audit.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ExecuteAsync(UnitOfWork unitOfWork, string sql, CancellationToken cancellationToken, params object?[] parameters)
    {
        await using var command = unitOfWork.Command(sql, parameters);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
