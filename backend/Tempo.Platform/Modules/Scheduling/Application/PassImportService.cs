using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Domain;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary>One row of the file, as the console read it: cells trimmed, nothing normalized yet (docs/40 section 3).</summary>
public sealed record PassImportRowInput(
    int Line,
    string? Email,
    string? Phone,
    string? Product,
    string? EntriesLeft,
    string? ValidFrom,
    string? ValidUntil);

/// <summary>What became of one row (docs/40 section 4).</summary>
public sealed record PassImportRowOutcome(
    int Line,
    string Outcome,
    Guid? PersonId = null,
    Guid? PassId = null,
    int? DuplicateOfLine = null,
    string? Field = null,
    string? Code = null);

public sealed record PassImportResult(bool DryRun, Guid? ImportId, ImportTotals Totals, IReadOnlyList<PassImportRowOutcome> Rows);

/// <summary>
/// Pass balance import from a file (docs/40): after the people import, each row names a person already in the studio,
/// one of its active products and what is left on the pass. This service checks every row, finds the passes an earlier
/// run made, and on a commit creates the rest in one transaction with a fixed number of set-based statements. It never
/// changes a pass or a person, records no money and sends nothing. The route permission (`people.import`) is checked by
/// the API; `passes.manage` is checked here (PI-1).
/// </summary>
public interface IPassImportService
{
    Task<PassImportResult> ImportAsync(TenantContext tenant, bool dryRun, IReadOnlyList<PassImportRowInput> rows, CancellationToken cancellationToken);
}

public sealed class PassImportService(IDataSourceProvider dataSources, TimeProvider clock) : IPassImportService
{
    public const int MaxRows = PeopleImportService.MaxRows;

    /// <summary>The furthest a pass may run (PI-7), the longest product validity (docs/29).</summary>
    public const int MaxDaysAhead = 730;

    private static readonly string[] DateFormats = ["d/M/yyyy", "d.M.yyyy", "yyyy-MM-dd"];

    private sealed record Person(Guid Id, string Status);

    private sealed record Product(Guid Id, string Kind, int? Entries);

    private sealed record ReadyRow(int Index, int Line, Guid PersonId, Product Product, int? EntriesLeft, DateOnly StartsOn, DateOnly EndsOn);

    public async Task<PassImportResult> ImportAsync(TenantContext tenant, bool dryRun, IReadOnlyList<PassImportRowInput> rows, CancellationToken cancellationToken)
    {
        if (!tenant.Has(Permissions.PassesManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Importing passes needs the right to grant passes.");
        }

        if (rows.Count == 0 || rows.Count > MaxRows)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "import.too_many_rows", $"An import holds 1 to {MaxRows} rows. Split the file.", "rows");
        }

        var outcomes = new PassImportRowOutcome?[rows.Count];
        PassImportRowOutcome Invalid(int i, string field, string code, Guid? personId = null) => new(rows[i].Line, Outcomes.Invalid, personId, Field: field, Code: code);

        // Check 1 and 2: the contact, in memory.
        var contacts = new (string? Email, string? Phone)[rows.Count];
        for (var i = 0; i < rows.Count; i++)
        {
            string? phone = null, email = null;
            try
            {
                phone = Clean(rows[i].Phone) is { } rawPhone ? ContactValues.Phone(rawPhone) : null;
            }
            catch (DomainRuleViolationException)
            {
                outcomes[i] = Invalid(i, "phone", "phone.invalid");
                continue;
            }

            try
            {
                email = Clean(rows[i].Email) is { } rawEmail ? ContactValues.Email(rawEmail) : null;
            }
            catch (DomainRuleViolationException)
            {
                outcomes[i] = Invalid(i, "email", "email.invalid");
                continue;
            }

            if (phone is null && email is null)
            {
                outcomes[i] = Invalid(i, "contact", "contact.required");
                continue;
            }

            contacts[i] = (email, phone);
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);

        // Two imports into one studio at once would both miss each other's passes; the second waits for the first.
        await using (var lockStudio = unitOfWork.Command("SELECT pg_advisory_xact_lock(hashtextextended('passes.import:' || $1::text, 0))", tenant.OrganizationId))
        {
            await lockStudio.ExecuteNonQueryAsync(cancellationToken);
        }

        var today = await TodayAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var people = await PeopleAsync(unitOfWork, tenant.OrganizationId, contacts, cancellationToken);
        var products = await ProductsAsync(unitOfWork, tenant.OrganizationId, cancellationToken);

        // Checks 3 to 10, then repeats inside the file.
        var ready = new List<ReadyRow>();
        var seen = new Dictionary<(Guid, Guid), int>();
        for (var i = 0; i < rows.Count; i++)
        {
            if (outcomes[i] is not null)
            {
                continue;
            }

            var row = rows[i];
            var (email, phone) = contacts[i];
            var byEmail = email is null ? null : people.GetValueOrDefault("email:" + email);
            var byPhone = phone is null ? null : people.GetValueOrDefault("phone:" + phone);
            if (byEmail is null && byPhone is null)
            {
                outcomes[i] = Invalid(i, "person", "person.not_found");
                continue;
            }

            if (byEmail is not null && byPhone is not null && byEmail.Id != byPhone.Id)
            {
                outcomes[i] = Invalid(i, "person", "person.ambiguous");
                continue;
            }

            var person = (byEmail ?? byPhone)!;
            if (person.Status != "active")
            {
                outcomes[i] = Invalid(i, "person", "person.read_only", person.Id);
                continue;
            }

            if (CheckRest(row, products, today, out var product, out var entriesLeft, out var startsOn, out var endsOn) is { } failure)
            {
                outcomes[i] = Invalid(i, failure.Field, failure.Code, person.Id);
                continue;
            }

            if (seen.TryGetValue((person.Id, product!.Id), out var earlier))
            {
                outcomes[i] = new PassImportRowOutcome(row.Line, Outcomes.DuplicateInFile, person.Id, DuplicateOfLine: earlier);
                continue;
            }

            seen[(person.Id, product.Id)] = row.Line;
            ready.Add(new ReadyRow(i, row.Line, person.Id, product, entriesLeft, startsOn, endsOn));
        }

        // PI-8: a pass an earlier run made is `exists`, so a second run adds nothing.
        var imported = await ImportedAsync(unitOfWork, tenant.OrganizationId, ready, cancellationToken);
        var toCreate = new List<ReadyRow>();
        foreach (var row in ready)
        {
            if (imported.TryGetValue((row.PersonId, row.Product.Id, row.EndsOn), out var passId))
            {
                outcomes[row.Index] = new PassImportRowOutcome(row.Line, Outcomes.Exists, row.PersonId, passId);
            }
            else
            {
                toCreate.Add(row);
            }
        }

        Guid? importId = null;
        var ids = toCreate.ToDictionary(r => r.Index, _ => Guid.CreateVersion7());
        if (!dryRun && toCreate.Count > 0)
        {
            importId = Guid.CreateVersion7();
            await CreateAsync(unitOfWork, tenant, importId.Value, toCreate, ids, cancellationToken);
        }

        foreach (var row in toCreate)
        {
            outcomes[row.Index] = new PassImportRowOutcome(row.Line, dryRun ? Outcomes.Valid : Outcomes.Created, row.PersonId, dryRun ? null : ids[row.Index]);
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
                new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "passes.imported", "organization", tenant.OrganizationId, tenant.CorrelationId,
                    new { importId = id, rows = totals.Rows, created = totals.Created, exists = totals.Exists, duplicateInFile = totals.DuplicateInFile, invalid = totals.Invalid }),
                cancellationToken);
            await unitOfWork.CommitAsync(cancellationToken);
        }

        return new PassImportResult(dryRun, importId, totals, result);
    }

    private static class Outcomes
    {
        public const string Valid = PeopleImportService.Outcomes.Valid;
        public const string Created = PeopleImportService.Outcomes.Created;
        public const string Exists = PeopleImportService.Outcomes.Exists;
        public const string DuplicateInFile = PeopleImportService.Outcomes.DuplicateInFile;
        public const string Invalid = PeopleImportService.Outcomes.Invalid;
    }

    /// <summary>Checks 6 to 10 of docs/40 section 4, in order; the first failure wins.</summary>
    private static (string Field, string Code)? CheckRest(
        PassImportRowInput row,
        IReadOnlyList<(string Name, Product Product)> products,
        DateOnly today,
        out Product? product,
        out int? entriesLeft,
        out DateOnly startsOn,
        out DateOnly endsOn)
    {
        product = null;
        entriesLeft = null;
        startsOn = endsOn = default;

        if (Clean(row.Product) is not { } name)
        {
            return ("product", "required");
        }

        var matches = products.Where(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();
        switch (matches.Count)
        {
            case 0:
                return ("product", "product.not_found");
            case > 1:
                return ("product", "product.ambiguous");
        }

        product = matches[0].Product;
        var left = Clean(row.EntriesLeft);
        if (product.Kind == "punch_card")
        {
            if (left is null)
            {
                return ("entries_left", "required");
            }

            if (!int.TryParse(left, NumberStyles.None, CultureInfo.InvariantCulture, out var count) || count < 1)
            {
                return ("entries_left", "entries_left.invalid");
            }

            if (count > product.Entries)
            {
                return ("entries_left", "entries_left.too_many");
            }

            entriesLeft = count;
        }
        else if (left is not null)
        {
            return ("entries_left", "entries_left.not_allowed");
        }

        if (Clean(row.ValidUntil) is not { } until)
        {
            return ("valid_until", "required");
        }

        if (!TryDate(until, out endsOn))
        {
            return ("valid_until", "date.invalid");
        }

        if (endsOn < today)
        {
            return ("valid_until", "valid_until.past");
        }

        if (endsOn > today.AddDays(MaxDaysAhead))
        {
            return ("valid_until", "valid_until.too_far");
        }

        startsOn = today;
        if (Clean(row.ValidFrom) is { } from)
        {
            if (!TryDate(from, out startsOn))
            {
                return ("valid_from", "date.invalid");
            }

            if (startsOn > endsOn)
            {
                return ("valid_from", "valid_from.after_until");
            }
        }

        // An empty valid-from is today, which can be after a valid-until of today only if today moved; it can't.
        return null;
    }

    private static bool TryDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private async Task<DateOnly> TodayAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
    }

    /// <summary>Section 5 step 2: every email and phone of the file to its person, in one query.</summary>
    private static async Task<Dictionary<string, Person>> PeopleAsync(UnitOfWork unitOfWork, Guid organizationId, (string? Email, string? Phone)[] contacts, CancellationToken cancellationToken)
    {
        var found = new Dictionary<string, Person>(StringComparer.Ordinal);
        var keys = contacts
            .SelectMany(c => new (string Type, string? Value)[] { ("email", c.Email), ("phone", c.Phone) })
            .Where(k => k.Value is not null)
            .Select(k => (k.Type, Value: k.Value!))
            .Distinct()
            .ToList();
        if (keys.Count == 0)
        {
            return found;
        }

        await using var command = unitOfWork.Command(
            """
            SELECT DISTINCT ON (cp.type, cp.value) cp.type, cp.value, p.id, p.status
            FROM unnest($2::text[], $3::text[]) AS v(type, value)
            JOIN people.contact_points cp ON cp.organization_id = $1 AND cp.type = v.type AND cp.value = v.value
            JOIN people.people p ON p.organization_id = cp.organization_id AND p.id = cp.person_id
            ORDER BY cp.type, cp.value, (p.status = 'active') DESC, p.id
            """,
            organizationId,
            keys.Select(k => k.Type).ToArray(),
            keys.Select(k => k.Value).ToArray());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            found[reader.GetString(0) + ":" + reader.GetString(1)] = new Person(reader.GetGuid(2), reader.GetString(3));
        }

        return found;
    }

    /// <summary>Section 5 step 3: the studio's active products, by their trimmed names.</summary>
    private static async Task<List<(string Name, Product Product)>> ProductsAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT id, btrim(name), kind, entries FROM scheduling.pass_products WHERE organization_id = $1 AND status = 'active'",
            organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var products = new List<(string, Product)>();
        while (await reader.ReadAsync(cancellationToken))
        {
            products.Add((reader.GetString(1), new Product(reader.GetGuid(0), reader.GetString(2), await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetInt32(3))));
        }

        return products;
    }

    /// <summary>Section 5 step 4: the active imported passes of the people found, for PI-8.</summary>
    private static async Task<Dictionary<(Guid, Guid, DateOnly), Guid>> ImportedAsync(UnitOfWork unitOfWork, Guid organizationId, List<ReadyRow> rows, CancellationToken cancellationToken)
    {
        var found = new Dictionary<(Guid, Guid, DateOnly), Guid>();
        if (rows.Count == 0)
        {
            return found;
        }

        await using var command = unitOfWork.Command(
            """
            SELECT person_id, product_id, ends_on, id
            FROM scheduling.passes
            WHERE organization_id = $1 AND person_id = ANY($2::uuid[]) AND source = 'import' AND status = 'active'
            ORDER BY created_at
            """,
            organizationId,
            rows.Select(r => r.PersonId).Distinct().ToArray());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            found.TryAdd((reader.GetGuid(0), reader.GetGuid(1), await reader.GetFieldValueAsync<DateOnly>(2, cancellationToken)), reader.GetGuid(3));
        }

        return found;
    }

    /// <summary>Section 5 steps 6 and 7: a fixed number of statements, whatever the number of rows.</summary>
    private static async Task CreateAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid importId, List<ReadyRow> rows, Dictionary<int, Guid> ids, CancellationToken cancellationToken)
    {
        var passIds = rows.Select(r => ids[r.Index]).ToArray();

        // A card keeps its product's size and starts with what was already used (PI-6); a membership counts nothing.
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, entries_used, status, granted_by, source, created_at, updated_at)
            SELECT $1, r.id, r.person_id, r.product_id, r.starts_on, r.ends_on, r.entries, r.entries_used, 'active', $2, 'import', now(), now()
            FROM unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::date[], $7::date[], $8::int[], $9::int[])
                AS r(id, person_id, product_id, starts_on, ends_on, entries, entries_used)
            """,
            tenant.OrganizationId,
            tenant.MembershipId,
            passIds,
            rows.Select(r => r.PersonId).ToArray(),
            rows.Select(r => r.Product.Id).ToArray(),
            rows.Select(r => r.StartsOn).ToArray(),
            rows.Select(r => r.EndsOn).ToArray(),
            rows.Select(r => r.Product.Entries).ToArray(),
            rows.Select(r => r.Product.Entries - r.EntriesLeft ?? 0).ToArray()))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        // One `pass.granted` per pass, as grantPass writes it, with the source and no name, email or phone (PI-9).
        await using var audit = unitOfWork.Command(
            """
            INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, target_id, correlation_id, data)
            SELECT uuidv7(), $1, now(), 'user', $2, 'pass.granted', 'pass', t.id, $3,
                   jsonb_build_object('personId', t.person_id, 'productId', t.product_id, 'source', 'import', 'importId', $4::uuid)
            FROM unnest($5::uuid[], $6::uuid[], $7::uuid[]) AS t(id, person_id, product_id)
            """,
            tenant.OrganizationId,
            tenant.UserAccountId,
            tenant.CorrelationId,
            importId,
            passIds,
            rows.Select(r => r.PersonId).ToArray(),
            rows.Select(r => r.Product.Id).ToArray());
        await audit.ExecuteNonQueryAsync(cancellationToken);
    }
}
