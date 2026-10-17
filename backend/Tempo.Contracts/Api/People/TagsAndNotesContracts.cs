namespace Tempo.Contracts.Api.People;

/// <summary>`Tag` in contracts/openapi/tempo-api.v1.yaml (docs/34 section 7).</summary>
public sealed record TagResponse(Guid Id, string Name, int Color, int PeopleCount, DateTimeOffset CreatedAt, string Version);

/// <summary>`TagList`.</summary>
public sealed record TagListResponse(IReadOnlyList<TagResponse> Items);

/// <summary>`CreateTagRequest`.</summary>
public sealed record CreateTagRequest(string? Name, int? Color);

/// <summary>`UpdateTagRequest`: a name, a colour or both.</summary>
public sealed record UpdateTagRequest(string? Name, int? Color);

/// <summary>`PersonTag`: a tag as it shows on a person.</summary>
public sealed record PersonTagResponse(Guid Id, string Name, int Color);

/// <summary>`PersonTagList`.</summary>
public sealed record PersonTagListResponse(IReadOnlyList<PersonTagResponse> Items);

/// <summary>`PersonNote` (docs/34 section 8).</summary>
public sealed record PersonNoteResponse(
    Guid Id,
    string Body,
    DateTimeOffset CreatedAt,
    Guid? AuthorMembershipId,
    string? AuthorName,
    string AuthorRole,
    bool Mine);

/// <summary>`PersonNotePage`.</summary>
public sealed record PersonNotePageResponse(IReadOnlyList<PersonNoteResponse> Items, Guid? NextBefore);

/// <summary>`CreatePersonNoteRequest`.</summary>
public sealed record CreatePersonNoteRequest(string? Body);

/// <summary>`ExportNote`: the author by role, never by name (docs/34 section 9).</summary>
public sealed record ExportNoteResponse(string Body, DateTimeOffset CreatedAt, string AuthorRole);
