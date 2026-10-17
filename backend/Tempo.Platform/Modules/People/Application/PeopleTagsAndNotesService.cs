using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.People.Application;

public sealed record TagView(Guid Id, string Name, int Color, int PeopleCount, DateTimeOffset CreatedAt, long Version);

public sealed record PersonTagView(Guid Id, string Name, int Color);

public sealed record PersonNoteView(
    Guid Id,
    string Body,
    DateTimeOffset CreatedAt,
    Guid? AuthorMembershipId,
    string? AuthorName,
    string AuthorRole,
    bool Mine);

public sealed record PersonNotePage(IReadOnlyList<PersonNoteView> Items, Guid? NextBefore);

/// <summary>
/// The studio's tags and staff notes on a person (docs/34 sections 7 and 8). Route permissions are checked by the API
/// (`people.view`, `people.tags.manage`, `people.manage`, `people.notes.view`, `people.notes.manage`); deleting someone
/// else's note needs `people.notes.moderate`, checked here. The audit keeps ids only, never a note's text.
/// </summary>
public interface IPeopleTagsAndNotesService
{
    Task<IReadOnlyList<TagView>> ListTagsAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<TagView> CreateTagAsync(TenantContext tenant, string? name, int? color, CancellationToken cancellationToken);

    Task<TagView> UpdateTagAsync(TenantContext tenant, Guid tagId, string? name, int? color, long? expectedVersion, CancellationToken cancellationToken);

    Task DeleteTagAsync(TenantContext tenant, Guid tagId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PersonTagView>> TagPersonAsync(TenantContext tenant, Guid personId, Guid tagId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PersonTagView>> UntagPersonAsync(TenantContext tenant, Guid personId, Guid tagId, CancellationToken cancellationToken);

    Task<PersonNotePage> ListNotesAsync(TenantContext tenant, Guid personId, Guid? before, int limit, CancellationToken cancellationToken);

    Task<PersonNoteView> AddNoteAsync(TenantContext tenant, Guid personId, string? body, CancellationToken cancellationToken);

    Task DeleteNoteAsync(TenantContext tenant, Guid personId, Guid noteId, CancellationToken cancellationToken);
}

public sealed class PeopleTagsAndNotesService(IDataSourceProvider dataSources) : IPeopleTagsAndNotesService
{
    public const int MaxTagsPerStudio = 100;
    public const int MaxTagsPerPerson = 20;
    public const int MaxNameLength = 30;
    public const int MaxNoteLength = 1000;
    public const int MaxLimit = 100;

    private const string TagColumns =
        """
        t.id, t.name, t.color,
        (SELECT count(*) FROM people.person_tags pt WHERE pt.organization_id = t.organization_id AND pt.tag_id = t.id)::int,
        t.created_at, t.version
        """;

    public async Task<IReadOnlyList<TagView>> ListTagsAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command($"SELECT {TagColumns} FROM people.tags t WHERE t.organization_id = $1 ORDER BY lower(t.name)", tenant.OrganizationId);
        return await ReadTagsAsync(command, cancellationToken);
    }

    public async Task<TagView> CreateTagAsync(TenantContext tenant, string? name, int? color, CancellationToken cancellationToken)
    {
        var cleanName = TagName(name) ?? throw new DomainRuleViolationException(ViolationKind.Validation, "tag.name_required", "A tag needs a name.", "name");
        var cleanColor = Color(color) ?? throw new DomainRuleViolationException(ViolationKind.Validation, "tag.color_invalid", "Pick one of the six colours.", "color");

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockStudioTagsAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await using (var count = unitOfWork.Command("SELECT count(*) FROM people.tags WHERE organization_id = $1", tenant.OrganizationId))
        {
            if ((long)(await count.ExecuteScalarAsync(cancellationToken))! >= MaxTagsPerStudio)
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "tag.limit_reached", $"A studio has at most {MaxTagsPerStudio} tags.");
            }
        }

        var id = Guid.CreateVersion7();
        await ExecuteTagWriteAsync(
            unitOfWork,
            "INSERT INTO people.tags (organization_id, id, name, color, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())",
            cancellationToken,
            tenant.OrganizationId,
            id,
            cleanName,
            (short)cleanColor);
        await AuditAsync(unitOfWork, tenant, "tag.created", "tag", id, new { color = cleanColor }, cancellationToken);
        var created = await TagAsync(unitOfWork, tenant.OrganizationId, id, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<TagView> UpdateTagAsync(TenantContext tenant, Guid tagId, string? name, int? color, long? expectedVersion, CancellationToken cancellationToken)
    {
        var cleanName = name is null ? null : TagName(name) ?? throw new DomainRuleViolationException(ViolationKind.Validation, "tag.name_required", "A tag needs a name.", "name");
        int? cleanColor = color is null ? null : Color(color) ?? throw new DomainRuleViolationException(ViolationKind.Validation, "tag.color_invalid", "Pick one of the six colours.", "color");
        if (cleanName is null && cleanColor is null)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.empty", "Send a name or a colour.");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = await TagAsync(unitOfWork, tenant.OrganizationId, tagId, cancellationToken, forUpdate: true);
        if (expectedVersion is { } expected && expected != current.Version)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
        }

        await ExecuteTagWriteAsync(
            unitOfWork,
            "UPDATE people.tags SET name = $3, color = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            cancellationToken,
            tenant.OrganizationId,
            tagId,
            cleanName ?? current.Name,
            (short)(cleanColor ?? current.Color));
        var fields = new List<string>();
        if (cleanName is not null && cleanName != current.Name)
        {
            fields.Add("name");
        }

        if (cleanColor is not null && cleanColor != current.Color)
        {
            fields.Add("color");
        }

        await AuditAsync(unitOfWork, tenant, "tag.updated", "tag", tagId, new { fields }, cancellationToken);
        var updated = await TagAsync(unitOfWork, tenant.OrganizationId, tagId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task DeleteTagAsync(TenantContext tenant, Guid tagId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = await TagAsync(unitOfWork, tenant.OrganizationId, tagId, cancellationToken, forUpdate: true);
        await using (var delete = unitOfWork.Command("DELETE FROM people.tags WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, tagId))
        {
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "tag.deleted", "tag", tagId, new { peopleUntagged = current.PeopleCount }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PersonTagView>> TagPersonAsync(TenantContext tenant, Guid personId, Guid tagId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockLivePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await TagAsync(unitOfWork, tenant.OrganizationId, tagId, cancellationToken);
        var tags = await TagsOfAsync(unitOfWork, tenant.OrganizationId, [personId], cancellationToken);
        var current = tags.GetValueOrDefault(personId) ?? [];
        if (current.Any(t => t.Id == tagId))
        {
            return current;
        }

        if (current.Count >= MaxTagsPerPerson)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.tag_limit_reached", $"A person has at most {MaxTagsPerPerson} tags.");
        }

        await using (var insert = unitOfWork.Command(
            "INSERT INTO people.person_tags (organization_id, person_id, tag_id, created_at) VALUES ($1, $2, $3, now())",
            tenant.OrganizationId,
            personId,
            tagId))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "person.tagged", "person", personId, new { tagId }, cancellationToken);
        var after = (await TagsOfAsync(unitOfWork, tenant.OrganizationId, [personId], cancellationToken)).GetValueOrDefault(personId) ?? [];
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    public async Task<IReadOnlyList<PersonTagView>> UntagPersonAsync(TenantContext tenant, Guid personId, Guid tagId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockLivePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await TagAsync(unitOfWork, tenant.OrganizationId, tagId, cancellationToken);
        int removed;
        await using (var delete = unitOfWork.Command(
            "DELETE FROM people.person_tags WHERE organization_id = $1 AND person_id = $2 AND tag_id = $3",
            tenant.OrganizationId,
            personId,
            tagId))
        {
            removed = await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        if (removed > 0)
        {
            await AuditAsync(unitOfWork, tenant, "person.untagged", "person", personId, new { tagId }, cancellationToken);
        }

        var after = (await TagsOfAsync(unitOfWork, tenant.OrganizationId, [personId], cancellationToken)).GetValueOrDefault(personId) ?? [];
        await unitOfWork.CommitAsync(cancellationToken);
        return after;
    }

    public async Task<PersonNotePage> ListNotesAsync(TenantContext tenant, Guid personId, Guid? before, int limit, CancellationToken cancellationToken)
    {
        var take = Math.Clamp(limit, 1, MaxLimit);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await PersonExistsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await using var command = unitOfWork.Command(
            """
            SELECT n.id, n.body, n.created_at, n.author_membership_id,
                   (SELECT a.display_name FROM people.people a WHERE a.organization_id = n.organization_id AND a.membership_id = n.author_membership_id),
                   n.author_role
            FROM people.person_notes n
            WHERE n.organization_id = $1 AND n.person_id = $2 AND ($3::uuid IS NULL OR n.id < $3)
            ORDER BY n.id DESC
            LIMIT $4
            """,
            tenant.OrganizationId,
            personId,
            before,
            take + 1);
        var notes = new List<PersonNoteView>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                notes.Add(ReadNote(reader, tenant.MembershipId));
            }
        }

        var page = notes.Take(take).ToList();
        return new PersonNotePage(page, notes.Count > take ? page[^1].Id : null);
    }

    public async Task<PersonNoteView> AddNoteAsync(TenantContext tenant, Guid personId, string? body, CancellationToken cancellationToken)
    {
        var text = body?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "note.body_required", "Write the note.", "body");
        }

        if (text.Length > MaxNoteLength)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "note.too_long", $"A note is up to {MaxNoteLength} characters.", "body");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LockLivePersonAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var id = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO people.person_notes (organization_id, id, person_id, author_membership_id, author_role, body, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())
            """,
            tenant.OrganizationId,
            id,
            personId,
            tenant.MembershipId,
            AuthorRole(tenant.Role),
            text))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "person.note.added", "person", personId, new { noteId = id }, cancellationToken);
        var created = (await NotesAsync(unitOfWork, tenant, personId, id, cancellationToken)) ?? throw NoteNotFound();
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task DeleteNoteAsync(TenantContext tenant, Guid personId, Guid noteId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var note = await NotesAsync(unitOfWork, tenant, personId, noteId, cancellationToken) ?? throw NoteNotFound();
        var allowed = note.Mine ? tenant.Has(Permissions.PeopleNotesManage) : tenant.Has(Permissions.PeopleNotesModerate);
        if (!allowed)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You can delete only your own notes.");
        }

        await using (var delete = unitOfWork.Command("DELETE FROM people.person_notes WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, noteId))
        {
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "person.note.deleted", "person", personId, new { noteId, byModerator = !note.Mine }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    /// <summary>The tags of each person, by name: one query for a whole page (docs/34 section 7).</summary>
    internal static async Task<Dictionary<Guid, IReadOnlyList<PersonTagView>>> TagsOfAsync(UnitOfWork unitOfWork, Guid organizationId, Guid[] personIds, CancellationToken cancellationToken)
    {
        var tags = new Dictionary<Guid, List<PersonTagView>>();
        if (personIds.Length > 0)
        {
            await using var command = unitOfWork.Command(
                """
                SELECT pt.person_id, t.id, t.name, t.color
                FROM people.person_tags pt
                JOIN people.tags t ON t.organization_id = pt.organization_id AND t.id = pt.tag_id
                WHERE pt.organization_id = $1 AND pt.person_id = ANY($2::uuid[])
                ORDER BY lower(t.name)
                """,
                organizationId,
                personIds);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var person = reader.GetGuid(0);
                if (!tags.TryGetValue(person, out var list))
                {
                    tags[person] = list = [];
                }

                list.Add(new PersonTagView(reader.GetGuid(1), reader.GetString(2), reader.GetInt16(3)));
            }
        }

        return tags.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<PersonTagView>)kv.Value);
    }

    private static async Task<PersonNoteView?> NotesAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid personId, Guid noteId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT n.id, n.body, n.created_at, n.author_membership_id,
                   (SELECT a.display_name FROM people.people a WHERE a.organization_id = n.organization_id AND a.membership_id = n.author_membership_id),
                   n.author_role
            FROM people.person_notes n
            WHERE n.organization_id = $1 AND n.person_id = $2 AND n.id = $3
            """,
            tenant.OrganizationId,
            personId,
            noteId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadNote(reader, tenant.MembershipId) : null;
    }

    private static PersonNoteView ReadNote(NpgsqlDataReader reader, Guid caller)
    {
        Guid? author = reader.IsDBNull(3) ? null : reader.GetGuid(3);
        return new PersonNoteView(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetFieldValue<DateTimeOffset>(2),
            author,
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetString(5),
            author == caller);
    }

    private static string AuthorRole(MembershipRole role) => role switch
    {
        MembershipRole.Owner => "owner",
        MembershipRole.Admin => "admin",
        _ => "staff"
    };

    private static string? TagName(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length > MaxNameLength
            ? throw new DomainRuleViolationException(ViolationKind.Validation, "tag.name_too_long", $"A tag name is up to {MaxNameLength} characters.", "name")
            : trimmed;
    }

    private static int? Color(int? color) => color is >= 1 and <= 6 ? color : null;

    private static async Task<TagView> TagAsync(UnitOfWork unitOfWork, Guid organizationId, Guid tagId, CancellationToken cancellationToken, bool forUpdate = false)
    {
        await using var command = unitOfWork.Command(
            $"SELECT {TagColumns} FROM people.tags t WHERE t.organization_id = $1 AND t.id = $2{(forUpdate ? " FOR UPDATE" : string.Empty)}",
            organizationId,
            tagId);
        return (await ReadTagsAsync(command, cancellationToken)).SingleOrDefault()
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "tag.not_found", "Tag not found.");
    }

    private static async Task<List<TagView>> ReadTagsAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var tags = new List<TagView>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            tags.Add(new TagView(reader.GetGuid(0), reader.GetString(1), reader.GetInt16(2), reader.GetInt32(3), reader.GetFieldValue<DateTimeOffset>(4), reader.GetInt64(5)));
        }

        return tags;
    }

    /// <summary>An insert or rename that would clash with another tag's name, ignoring case, is 409 `tag.name_taken`.</summary>
    private static async Task ExecuteTagWriteAsync(UnitOfWork unitOfWork, string sql, CancellationToken cancellationToken, params object?[] parameters)
    {
        try
        {
            await using var command = unitOfWork.Command(sql, parameters);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation && ex.ConstraintName == "ux_tags_name")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "tag.name_taken", "There is already a tag with that name.", "name");
        }
    }

    private static async Task LockStudioTagsAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT pg_advisory_xact_lock(hashtextextended('people.tags:' || $1::text, 0))", organizationId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task LockLivePersonAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT status FROM people.people WHERE organization_id = $1 AND id = $2 FOR UPDATE",
            organizationId,
            personId);
        var status = await command.ExecuteScalarAsync(cancellationToken) as string ?? throw PeopleService.PersonNotFound();
        if (status is "anonymized" or "merged")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "This record can no longer change.");
        }
    }

    private static async Task PersonExistsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2", organizationId, personId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw PeopleService.PersonNotFound();
        }
    }

    private static DomainRuleViolationException NoteNotFound() =>
        new(ViolationKind.NotFound, "note.not_found", "Note not found.");

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, string targetType, Guid targetId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, targetType, targetId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
