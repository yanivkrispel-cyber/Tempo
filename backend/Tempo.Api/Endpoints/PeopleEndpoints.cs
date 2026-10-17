using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Authorization;
using Tempo.Contracts.Api.Organizations;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// A studio's person records (docs/27 sections 4 and 6). The service holds the
/// rules; these handlers translate HTTP. Staff may read and edit people (A-2).
/// </summary>
public static class PeopleEndpoints
{
    public static IEndpointRouteBuilder MapPeopleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/people", ListAsync).RequirePermission(Permissions.PeopleView).WithName("listPeople").Produces<PersonPageResponse>();
        tenant.MapPost("/people", CreateAsync).RequirePermission(Permissions.PeopleManage).WithName("createPerson").Produces<PersonDetailResponse>(StatusCodes.Status201Created);
        tenant.MapGet("/people/{personId:guid}", GetAsync).RequirePermission(Permissions.PeopleView).WithName("getPerson").Produces<PersonDetailResponse>();
        tenant.MapPatch("/people/{personId:guid}", UpdateAsync).RequirePermission(Permissions.PeopleManage).WithName("updatePerson").Produces<PersonDetailResponse>();
        tenant.MapPost("/people/{personId:guid}/contact-points", AddContactAsync).RequirePermission(Permissions.PeopleManage).WithName("addContactPoint").Produces<ContactPointResponse>(StatusCodes.Status201Created);
        tenant.MapPatch("/people/{personId:guid}/contact-points/{contactPointId:guid}", UpdateContactAsync).RequirePermission(Permissions.PeopleManage).WithName("updateContactPoint").Produces<ContactPointResponse>();
        tenant.MapPost("/people/{personId:guid}/invite", InviteAsync).RequirePermission(Permissions.MembersInviteStaff).WithName("invitePerson").Produces<CreatedInvitationResponse>(StatusCodes.Status201Created);
        tenant.MapDelete("/people/{personId:guid}/contact-points/{contactPointId:guid}", DeleteContactAsync).RequirePermission(Permissions.PeopleManage).WithName("deleteContactPoint").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, string? query, string? status, Guid? before, int? limit, Guid? tag, IPeopleService people)
    {
        var page = await people.ListAsync(TenantRouteFilter.Current(httpContext), new PeopleQuery(query, status, before, limit ?? 50, tag), httpContext.RequestAborted);
        return Results.Ok(new PersonPageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> CreateAsync(HttpContext httpContext, CreatePersonRequest request, IPeopleService people)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var created = await people.CreateAsync(
            tenant,
            new NewPerson(request.DisplayName, request.GivenName, request.FamilyName, request.BirthDate, request.Email, request.Phone),
            httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/people/{created.Person.Id}", ToResponse(created));
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, Guid personId, IPeopleService people) =>
        Results.Ok(ToResponse(await people.GetAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted)));

    private static async Task<IResult> UpdateAsync(
        HttpContext httpContext,
        Guid personId,
        [FromBody] JsonElement body,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IPeopleService people)
    {
        var updated = await people.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            personId,
            ReadChanges(body),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    /// <summary>Invites a recorded person to the app as a client; accepting links the login to this record (section 4.5).</summary>
    private static async Task<IResult> InviteAsync(
        HttpContext httpContext,
        Guid personId,
        InvitePersonRequest request,
        IPeopleService people,
        IInvitationService invitations,
        AppLinks links)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var email = await people.PrepareInvitationAsync(tenant, personId, request.Email ?? string.Empty, httpContext.RequestAborted);
        var created = await invitations.CreateAsync(tenant, email, MembershipRole.Client, httpContext.RequestAborted, personId);
        var i = created.Invitation;
        return Results.Created(
            $"/api/v1/organizations/{tenant.OrganizationId}/invitations/{i.Id}",
            new CreatedInvitationResponse(
                i.Id,
                i.Email,
                StoredValue.Of(i.Role),
                StoredValue.Of(i.Status),
                i.ExpiresAt,
                i.CreatedAt,
                new InvitedByResponse(i.InvitedByMembershipId, i.InvitedByDisplayName),
                links.Invitation(i.Role, created.Token)));
    }

    private static async Task<IResult> AddContactAsync(HttpContext httpContext, Guid personId, CreateContactPointRequest request, IPeopleService people)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var added = await people.AddContactAsync(tenant, personId, request.Type ?? string.Empty, request.Value ?? string.Empty, request.IsPrimary ?? false, httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/people/{personId}/contact-points/{added.Id}", ToResponse(added));
    }

    private static async Task<IResult> UpdateContactAsync(
        HttpContext httpContext,
        Guid personId,
        Guid contactPointId,
        UpdateContactPointRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IPeopleService people)
    {
        if (request.IsPrimary == false)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "is_primary.invalid", "Make another contact primary instead.", "isPrimary");
        }

        var updated = await people.UpdateContactAsync(
            TenantRouteFilter.Current(httpContext),
            personId,
            contactPointId,
            request.Value,
            request.IsPrimary == true,
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> DeleteContactAsync(HttpContext httpContext, Guid personId, Guid contactPointId, IPeopleService people)
    {
        await people.DeleteContactAsync(TenantRouteFilter.Current(httpContext), personId, contactPointId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    /// <summary>Reads `UpdatePersonRequest`, where an explicit null clears a name or the birth date.</summary>
    internal static PersonChanges ReadChanges(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.invalid", "Send a JSON object.");
        }

        return new PersonChanges(
            body.TryGetProperty("displayName", out var displayName) ? StringOrInvalid(displayName, "displayName") : null,
            Nullable(body, "givenName", e => StringOrInvalid(e, "givenName")),
            Nullable(body, "familyName", e => StringOrInvalid(e, "familyName")),
            Nullable<DateOnly?>(body, "birthDate", e => DateOnly.TryParseExact(StringOrInvalid(e, "birthDate"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                ? (DateOnly?)d
                : throw new DomainRuleViolationException(ViolationKind.Validation, "birth_date.invalid", "Use yyyy-MM-dd.", "birthDate")),
            body.TryGetProperty("status", out var status) ? StringOrInvalid(status, "status") : null);
    }

    private static FieldChange<T?> Nullable<T>(JsonElement body, string name, Func<JsonElement, T> read)
    {
        if (!body.TryGetProperty(name, out var value))
        {
            return default;
        }

        return FieldChange.Set<T?>(value.ValueKind == JsonValueKind.Null ? default : read(value));
    }

    private static string StringOrInvalid(JsonElement value, string field) =>
        value.ValueKind == JsonValueKind.String
            ? value.GetString()!
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", $"{field} must be a string.", field);

    internal static PersonResponse ToResponse(PersonView p) =>
        new(p.Id, p.DisplayName, p.GivenName, p.FamilyName, p.BirthDate, p.Status, p.Source, p.HasLogin, p.MembershipId, p.PrimaryEmail, p.PrimaryPhone, p.MergedIntoId, p.CreatedAt, p.Version.ToString(CultureInfo.InvariantCulture), Tags(p));

    internal static PersonDetailResponse ToResponse(PersonDetailView d)
    {
        var p = d.Person;
        return new(
            p.Id, p.DisplayName, p.GivenName, p.FamilyName, p.BirthDate, p.Status, p.Source, p.HasLogin, p.MembershipId, p.PrimaryEmail, p.PrimaryPhone, p.MergedIntoId, p.CreatedAt,
            p.Version.ToString(CultureInfo.InvariantCulture),
            [.. d.ContactPoints.Select(ToResponse)],
            [.. d.Consents.Select(ToResponse)],
            [.. d.Relationships.Select(r => new RelationshipResponse(r.Id, r.Type, r.FromPersonId, r.ToPersonId, r.OtherDisplayName, r.CreatedAt))],
            Tags(p));
    }

    internal static ContactPointResponse ToResponse(ContactPointView c) =>
        new(c.Id, c.Type, c.Value, c.IsPrimary, c.Verified, c.Version.ToString(CultureInfo.InvariantCulture));

    internal static ConsentResponse ToResponse(ConsentView c) =>
        new(c.Id, c.Purpose, c.Channel, c.State, c.Method, c.TextVersion, c.RecordedByMembershipId is { } m ? new MemberRefResponse(m, null) : null, c.OccurredAt);

    internal static IReadOnlyList<PersonTagResponse> Tags(PersonView p) => [.. (p.Tags ?? []).Select(t => new PersonTagResponse(t.Id, t.Name, t.Color))];
}
