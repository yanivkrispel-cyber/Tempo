using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.People.Application;

public sealed record ConsentChoice(string? Purpose, string? Channel, string? State, string? TextVersion);

public sealed record ProfileChanges(string? DisplayName, FieldChange<string?> GivenName, FieldChange<string?> FamilyName, FieldChange<DateOnly?> BirthDate);

/// <summary>
/// The caller's own person record and consent in one studio (the self rule,
/// docs/27 section 3.4), consent recorded by staff from a paper form, the
/// consent history, and relationships (sections 4.3 and 4.4). Consent rows
/// are append-only: withdrawing is a new row, and the current state is the latest.
/// </summary>
public interface IConsentService
{
    Task<PersonDetailView> GetMyProfileAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<PersonDetailView> UpdateMyProfileAsync(TenantContext tenant, ProfileChanges changes, long? expectedVersion, CancellationToken cancellationToken);

    Task<ConsentView> RecordMyConsentAsync(TenantContext tenant, ConsentChoice choice, CancellationToken cancellationToken);

    Task<ConsentView> RecordOnBehalfAsync(TenantContext tenant, Guid personId, ConsentChoice choice, CancellationToken cancellationToken);

    Task<IReadOnlyList<ConsentView>> HistoryAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);

    Task<RelationshipView> AddRelationshipAsync(TenantContext tenant, Guid fromPersonId, string? type, Guid toPersonId, CancellationToken cancellationToken);

    Task DeleteRelationshipAsync(TenantContext tenant, Guid personId, Guid relationshipId, CancellationToken cancellationToken);
}

public sealed class ConsentService(IDataSourceProvider dataSources, IPeopleService people) : IConsentService
{
    private static readonly object RelationshipsChanged = new { fields = new[] { "relationships" } };

    public async Task<PersonDetailView> GetMyProfileAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, await MyPersonIdAsync(unitOfWork, tenant, cancellationToken), cancellationToken);
    }

    public async Task<PersonDetailView> UpdateMyProfileAsync(TenantContext tenant, ProfileChanges changes, long? expectedVersion, CancellationToken cancellationToken)
    {
        Guid personId;
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            personId = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        }

        // A member may not archive themselves, so status is never part of a profile change.
        return await people.UpdateAsync(
            tenant,
            personId,
            new PersonChanges(changes.DisplayName, changes.GivenName, changes.FamilyName, changes.BirthDate, null),
            expectedVersion,
            cancellationToken);
    }

    public async Task<ConsentView> RecordMyConsentAsync(TenantContext tenant, ConsentChoice choice, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var personId = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        var recorded = await InsertAsync(unitOfWork, tenant, personId, choice, "self", cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return recorded;
    }

    public async Task<ConsentView> RecordOnBehalfAsync(TenantContext tenant, Guid personId, ConsentChoice choice, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LiveAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var recorded = await InsertAsync(unitOfWork, tenant, personId, choice, "staff_on_behalf", cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return recorded;
    }

    public async Task<IReadOnlyList<ConsentView>> HistoryAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await ExistsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var history = new List<ConsentView>();
        await using var command = unitOfWork.Command(
            """
            SELECT id, purpose, channel, state, method, text_version, recorded_by, occurred_at
            FROM people.consents
            WHERE organization_id = $1 AND person_id = $2
            ORDER BY occurred_at DESC, id DESC
            """,
            tenant.OrganizationId,
            personId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            history.Add(await PeopleService.ReadConsentAsync(reader, cancellationToken));
        }

        return history;
    }

    public async Task<RelationshipView> AddRelationshipAsync(TenantContext tenant, Guid fromPersonId, string? type, Guid toPersonId, CancellationToken cancellationToken)
    {
        if (type is not ("guardian_of" or "emergency_contact_for"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "relationship.invalid_type", "Unknown relationship.", "type");
        }

        if (fromPersonId == toPersonId)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "relationship.self", "A person cannot be related to themselves.", "toPersonId");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await LiveAsync(unitOfWork, tenant.OrganizationId, fromPersonId, cancellationToken);
        await LiveAsync(unitOfWork, tenant.OrganizationId, toPersonId, cancellationToken);
        var id = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO people.person_relationships (organization_id, id, from_person_id, to_person_id, type, created_at)
            VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (organization_id, from_person_id, to_person_id, type) DO NOTHING
            """,
            tenant.OrganizationId,
            id,
            fromPersonId,
            toPersonId,
            type))
        {
            if (await insert.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "relationship.exists", "These two are already linked this way.");
            }
        }

        await AuditAsync(unitOfWork, tenant, "person.updated", fromPersonId, RelationshipsChanged, cancellationToken);
        var detail = await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, fromPersonId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return detail.Relationships.Single(r => r.Id == id);
    }

    public async Task DeleteRelationshipAsync(TenantContext tenant, Guid personId, Guid relationshipId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var delete = unitOfWork.Command(
            "DELETE FROM people.person_relationships WHERE organization_id = $1 AND id = $2 AND (from_person_id = $3 OR to_person_id = $3)",
            tenant.OrganizationId,
            relationshipId,
            personId))
        {
            if (await delete.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "relationship.not_found", "Relationship not found.");
            }
        }

        await AuditAsync(unitOfWork, tenant, "person.updated", personId, RelationshipsChanged, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static async Task<ConsentView> InsertAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid personId, ConsentChoice choice, string method, CancellationToken cancellationToken)
    {
        if (choice.Purpose is not ("marketing" or "reminders"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "consent.invalid", "Unknown purpose.", "purpose");
        }

        if (choice.Channel is not ("email" or "push" or "whatsapp"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "consent.invalid", "Unknown channel.", "channel");
        }

        if (choice.State is not ("granted" or "withdrawn"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "consent.invalid", "Consent is granted or withdrawn.", "state");
        }

        var textVersion = choice.TextVersion?.Trim();
        if (string.IsNullOrEmpty(textVersion) || textVersion.Length > 40)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "consent.invalid", "Name the version of the text the person saw.", "textVersion");
        }

        var id = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO people.consents (organization_id, id, person_id, purpose, channel, state, method, text_version, recorded_by, occurred_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
            RETURNING id, purpose, channel, state, method, text_version, recorded_by, occurred_at
            """,
            tenant.OrganizationId,
            id,
            personId,
            choice.Purpose,
            choice.Channel,
            choice.State,
            method,
            textVersion,
            tenant.MembershipId))
        {
            await using var reader = await insert.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            var recorded = await PeopleService.ReadConsentAsync(reader, cancellationToken);
            await reader.CloseAsync();
            await AuditAsync(unitOfWork, tenant, "consent.recorded", personId, new { purpose = choice.Purpose, channel = choice.Channel, state = choice.State, method }, cancellationToken);
            return recorded;
        }
    }

    private static async Task<Guid> MyPersonIdAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2 AND status IN ('active', 'archived')",
            tenant.OrganizationId,
            tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid id ? id : throw PeopleService.PersonNotFound();
    }

    private static async Task ExistsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2", organizationId, personId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw PeopleService.PersonNotFound();
        }
    }

    private static async Task LiveAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT status FROM people.people WHERE organization_id = $1 AND id = $2", organizationId, personId);
        var status = await command.ExecuteScalarAsync(cancellationToken) as string ?? throw PeopleService.PersonNotFound();
        if (status is "anonymized" or "merged")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "This record can no longer change.");
        }
    }

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid personId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "person", personId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
