using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Platform.Modules.People.Application;

public sealed record DuplicateCandidateView(Guid Id, string Reason, string Status, PersonView PersonA, PersonView PersonB, DateTimeOffset CreatedAt, long Version);

public sealed record DuplicateCandidatePage(IReadOnlyList<DuplicateCandidateView> Items, Guid? NextBefore);

public sealed record PersonExportView(DateTimeOffset ExportedAt, Guid OrganizationId, string OrganizationName, PersonDetailView Person, IReadOnlyList<ConsentView> ConsentHistory);

/// <summary>
/// Duplicate candidates and merge, export and erasure (docs/27 sections 4.6
/// and 4.7, delivery steps 9 and 10). A record that stops being live (merged
/// into another, or anonymized) always gives up its login and membership link,
/// so the account can come back and be linked again without breaking
/// `ux_people_login`. Step-up for export and erase is the API's job.
/// </summary>
public interface IPersonLifecycleService
{
    Task<DuplicateCandidatePage> ListCandidatesAsync(TenantContext tenant, string? status, Guid? before, int limit, CancellationToken cancellationToken);

    Task<DuplicateCandidateView> ResolveAsync(TenantContext tenant, Guid candidateId, string? resolution, Guid? survivorPersonId, CancellationToken cancellationToken);

    Task<PersonExportView> ExportAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);

    Task<PersonDetailView> EraseAsync(TenantContext tenant, Guid personId, string reason, CancellationToken cancellationToken);
}

public sealed class PersonLifecycleService(IDataSourceProvider dataSources, TimeProvider clock) : IPersonLifecycleService
{
    /// <summary>The name an anonymized record shows (`display_name` is required).</summary>
    public const string ErasedName = "נמחק";

    private const string CandidateColumns = "d.id, d.reason, d.status, d.person_a_id, d.person_b_id, d.created_at, d.version";

    public async Task<DuplicateCandidatePage> ListCandidatesAsync(TenantContext tenant, string? status, Guid? before, int limit, CancellationToken cancellationToken)
    {
        status ??= "open";
        if (status is not ("open" or "merged" or "not_duplicate"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "status.invalid", "Unknown status.", "status");
        }

        limit = Math.Clamp(limit, 1, PeopleService.MaxLimit);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command(
            $"""
            SELECT {CandidateColumns}
            FROM people.duplicate_candidates d
            WHERE d.organization_id = $1 AND d.status = $2 AND ($3::uuid IS NULL OR d.id < $3)
            ORDER BY d.id DESC
            LIMIT $4
            """,
            tenant.OrganizationId,
            status,
            before,
            limit + 1);
        var rows = await ReadCandidateRowsAsync(command, cancellationToken);
        var page = rows.Take(limit).ToList();
        var items = new List<DuplicateCandidateView>();
        foreach (var row in page)
        {
            items.Add(await WithPeopleAsync(unitOfWork, tenant.OrganizationId, row, cancellationToken));
        }

        return new DuplicateCandidatePage(items, rows.Count > limit ? page[^1].Id : null);
    }

    public async Task<DuplicateCandidateView> ResolveAsync(TenantContext tenant, Guid candidateId, string? resolution, Guid? survivorPersonId, CancellationToken cancellationToken)
    {
        if (resolution is not ("merge" or "not_duplicate"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "resolution.invalid", "Merge them, or mark them as two people.", "resolution");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        CandidateRow candidate;
        await using (var command = unitOfWork.Command(
            $"SELECT {CandidateColumns} FROM people.duplicate_candidates d WHERE d.organization_id = $1 AND d.id = $2 FOR UPDATE",
            tenant.OrganizationId,
            candidateId))
        {
            candidate = (await ReadCandidateRowsAsync(command, cancellationToken)).SingleOrDefault()
                ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "duplicate.not_found", "Duplicate not found.");
        }

        if (candidate.Status != "open")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "duplicate.resolved", "This pair was already resolved.");
        }

        if (resolution == "merge")
        {
            var survivor = survivorPersonId ?? throw new DomainRuleViolationException(ViolationKind.Validation, "survivor.required", "Choose the record to keep.", "survivorPersonId");
            if (survivor != candidate.PersonA && survivor != candidate.PersonB)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "survivor.invalid", "Keep one of the two records.", "survivorPersonId");
            }

            var merged = survivor == candidate.PersonA ? candidate.PersonB : candidate.PersonA;
            await MergeAsync(unitOfWork, tenant, survivor, merged, clock.GetUtcNow(), cancellationToken);
        }

        await using (var update = unitOfWork.Command(
            "UPDATE people.duplicate_candidates SET status = $3, resolved_by = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId,
            candidateId,
            resolution == "merge" ? "merged" : "not_duplicate",
            tenant.MembershipId))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "duplicate.resolved", "duplicate_candidate", candidateId, new { resolution, survivor = survivorPersonId }, cancellationToken);
        await using var reread = unitOfWork.Command($"SELECT {CandidateColumns} FROM people.duplicate_candidates d WHERE d.organization_id = $1 AND d.id = $2", tenant.OrganizationId, candidateId);
        var view = await WithPeopleAsync(unitOfWork, tenant.OrganizationId, (await ReadCandidateRowsAsync(reread, cancellationToken)).Single(), cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    public async Task<PersonExportView> ExportAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var detail = await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var history = new List<ConsentView>();
        await using (var command = unitOfWork.Command(
            "SELECT id, purpose, channel, state, method, text_version, recorded_by, occurred_at FROM people.consents WHERE organization_id = $1 AND person_id = $2 ORDER BY occurred_at, id",
            tenant.OrganizationId,
            personId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                history.Add(await PeopleService.ReadConsentAsync(reader, cancellationToken));
            }
        }

        string organizationName;
        await using (var org = unitOfWork.Command("SELECT display_name FROM organizations.organizations WHERE id = $1", tenant.OrganizationId))
        {
            organizationName = (string)(await org.ExecuteScalarAsync(cancellationToken))!;
        }

        await AuditAsync(unitOfWork, tenant, "person.exported", "person", personId, new { }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new PersonExportView(clock.GetUtcNow(), tenant.OrganizationId, organizationName, detail, history);
    }

    public async Task<PersonDetailView> EraseAsync(TenantContext tenant, Guid personId, string reason, CancellationToken cancellationToken)
    {
        reason = reason.Trim();
        if (reason.Length is < 5 or > 500)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "reason.length", "Write a reason of 5 to 500 characters.", "reason");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = (await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken, forUpdate: true)).Person;
        if (current.Status is "anonymized" or "merged")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "This record can no longer change.");
        }

        if (current.MembershipId == tenant.MembershipId)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "person.erase_self", "You cannot erase your own record here.");
        }

        var org = tenant.OrganizationId;
        await ExecuteAsync(unitOfWork, "DELETE FROM people.contact_points WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, personId);
        await ExecuteAsync(unitOfWork, "DELETE FROM people.person_relationships WHERE organization_id = $1 AND (from_person_id = $2 OR to_person_id = $2)", cancellationToken, org, personId);
        await ExecuteAsync(
            unitOfWork,
            "UPDATE people.duplicate_candidates SET status = 'not_duplicate', resolved_by = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND status = 'open' AND (person_a_id = $2 OR person_b_id = $2)",
            cancellationToken,
            org, personId, tenant.MembershipId);
        // Invitations sent to this record: a pending one can no longer link to it, so it is revoked, and every
        // one of them gives up the email it was sent to (review on #86).
        var revoked = new List<Guid>();
        await using (var revoke = unitOfWork.Command(
            """
            UPDATE organizations.invitations
            SET status = 'revoked', updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND person_id = $2 AND status = 'pending'
            RETURNING id
            """,
            org,
            personId))
        {
            await using var reader = await revoke.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                revoked.Add(reader.GetGuid(0));
            }
        }

        foreach (var id in revoked)
        {
            await AuditAsync(unitOfWork, tenant, "invitation.revoked", "invitation", id, new { reason = "person_erased" }, cancellationToken);
        }

        await ExecuteAsync(
            unitOfWork,
            "UPDATE organizations.invitations SET email = 'erased+' || id::text || '@invalid', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $2",
            cancellationToken,
            org, personId);
        await ExecuteAsync(
            unitOfWork,
            $"""
            UPDATE people.people
            SET display_name = '{ErasedName}', given_name = NULL, family_name = NULL, birth_date = NULL,
                status = 'anonymized', user_account_id = NULL, membership_id = NULL, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            """,
            cancellationToken,
            org, personId);

        // A pass note is the only free text in scheduling (docs/29 section 7).
        await ExecuteAsync(unitOfWork, "UPDATE scheduling.passes SET note = NULL WHERE organization_id = $1 AND person_id = $2 AND note IS NOT NULL", cancellationToken, org, personId);

        // Consent rows stay as proof: they hold states, timestamps and text versions, never names or contacts.
        // The reason is required but not kept: free text can name the person, and person.* audit data never
        // holds names (section 7; review on #77).
        await AuditAsync(unitOfWork, tenant, "person.erased", "person", personId, new { reasonGiven = true }, cancellationToken);
        var erased = await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return erased;
    }

    /// <summary>
    /// Moves everything of <paramref name="merged"/> to <paramref name="survivor"/> (section 4.6): contact
    /// points (duplicates dropped, the survivor's primaries kept), consent history (copied, because consent rows
    /// are append-only; the originals stay on the merged record), relationships, and the login link. The merged
    /// record keeps its id for other modules, points at the survivor, and gives up its login.
    /// </summary>
    private static async Task MergeAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid survivor, Guid merged, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var survivorView = (await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, survivor, cancellationToken, forUpdate: true)).Person;
        var mergedView = (await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, merged, cancellationToken, forUpdate: true)).Person;
        if (survivorView.Status is "anonymized" or "merged" || mergedView.Status is "anonymized" or "merged")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "One of these records can no longer change.");
        }

        if (survivorView.HasLogin && mergedView.HasLogin)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "person.merge_both_have_login", "Both records belong to people who sign in, so they are two people.");
        }

        // The merged record gives up its login first, so the unique login and membership indexes allow the move.
        Guid? movedAccount = null;
        Guid? movedMembership = null;
        await using (var read = unitOfWork.Command(
            "SELECT user_account_id, membership_id FROM people.people WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId,
            merged))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            movedAccount = await reader.IsDBNullAsync(0, cancellationToken) ? null : reader.GetGuid(0);
            movedMembership = await reader.IsDBNullAsync(1, cancellationToken) ? null : reader.GetGuid(1);
        }

        var org = tenant.OrganizationId;
        await ExecuteAsync(
            unitOfWork,
            """
            UPDATE people.people
            SET status = 'merged', merged_into_id = $3, user_account_id = NULL, membership_id = NULL, updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND id = $2
            """,
            cancellationToken,
            org, merged, survivor);

        if (movedAccount is { } account)
        {
            await ExecuteAsync(
                unitOfWork,
                "UPDATE people.people SET user_account_id = $3, membership_id = $4, status = 'active', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                cancellationToken,
                org, survivor, account, (object?)movedMembership ?? DBNull.Value);
        }

        // Contacts the survivor lacks; never a second primary of a type. The rest are dropped.
        await ExecuteAsync(
            unitOfWork,
            """
            UPDATE people.contact_points m
            SET person_id = $2,
                is_primary = m.is_primary AND NOT EXISTS (
                    SELECT 1 FROM people.contact_points s
                    WHERE s.organization_id = m.organization_id AND s.person_id = $2 AND s.type = m.type AND s.is_primary),
                updated_at = now(), version = version + 1
            WHERE m.organization_id = $1 AND m.person_id = $3
              AND NOT EXISTS (
                  SELECT 1 FROM people.contact_points s
                  WHERE s.organization_id = m.organization_id AND s.person_id = $2 AND s.type = m.type AND s.value = m.value)
            """,
            cancellationToken,
            org, survivor, merged);
        await ExecuteAsync(unitOfWork, "DELETE FROM people.contact_points WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, merged);

        // Consent history, copied with its original times; the originals stay on the merged record as proof.
        await ExecuteAsync(
            unitOfWork,
            """
            INSERT INTO people.consents (organization_id, id, person_id, purpose, channel, state, method, text_version, recorded_by, occurred_at)
            SELECT organization_id, uuidv7(), $2, purpose, channel, state, method, text_version, recorded_by, occurred_at
            FROM people.consents WHERE organization_id = $1 AND person_id = $3
            """,
            cancellationToken,
            org, survivor, merged);

        // Relationships, unless the survivor already has the same one or it would point at itself.
        await ExecuteAsync(
            unitOfWork,
            """
            INSERT INTO people.person_relationships (organization_id, id, from_person_id, to_person_id, type, created_at)
            SELECT organization_id, uuidv7(),
                   CASE WHEN from_person_id = $3 THEN $2 ELSE from_person_id END,
                   CASE WHEN to_person_id = $3 THEN $2 ELSE to_person_id END,
                   type, created_at
            FROM people.person_relationships
            WHERE organization_id = $1 AND (from_person_id = $3 OR to_person_id = $3)
              AND NOT (from_person_id IN ($2, $3) AND to_person_id IN ($2, $3))
            ON CONFLICT (organization_id, from_person_id, to_person_id, type) DO NOTHING
            """,
            cancellationToken,
            org, survivor, merged);
        await ExecuteAsync(
            unitOfWork,
            "DELETE FROM people.person_relationships WHERE organization_id = $1 AND (from_person_id = $2 OR to_person_id = $2)",
            cancellationToken,
            org, merged);

        // Other open pairs with the merged record are settled by this merge.
        await ExecuteAsync(
            unitOfWork,
            "UPDATE people.duplicate_candidates SET status = 'merged', resolved_by = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND status = 'open' AND (person_a_id = $2 OR person_b_id = $2)",
            cancellationToken,
            org, merged, tenant.MembershipId);

        await MoveSchedulingAsync(unitOfWork, tenant, survivor, merged, now, cancellationToken);
        await PeopleService.FlagDuplicatesAsync(unitOfWork, tenant.OrganizationId, survivor, cancellationToken);
        await AuditAsync(unitOfWork, tenant, "person.merged", "person", survivor, new { survivor, merged }, cancellationToken);
    }

    /// <summary>
    /// Bookings, passes and inbox items move to the survivor (docs/29 section 7). Where both records hold a place in
    /// one class, the stronger place stays, whichever record it belongs to: attended, then no-show, then booked, then
    /// waiting (a tie keeps the survivor's). The weaker place is cancelled (booked, waiting) or removed (attended,
    /// no-show), its entry returns and its seat goes to the waitlist, and it gets its own audit row (review on #111).
    /// </summary>
    private static async Task MoveSchedulingAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid survivor, Guid merged, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var org = tenant.OrganizationId;
        var pairs = new List<(Guid Session, Guid Survivors, string SurvivorStatus, Guid Merged, string MergedStatus)>();
        await using (var read = unitOfWork.Command(
            """
            SELECT s.session_id, s.id, s.status, m.id, m.status
            FROM scheduling.bookings s
            JOIN scheduling.bookings m ON m.organization_id = s.organization_id AND m.session_id = s.session_id
            WHERE s.organization_id = $1 AND s.person_id = $2 AND m.person_id = $3
              AND s.status IN ('booked', 'waitlisted', 'attended', 'no_show')
              AND m.status IN ('booked', 'waitlisted', 'attended', 'no_show')
            FOR UPDATE OF s, m
            """,
            org, survivor, merged))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                pairs.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetGuid(3), reader.GetString(4)));
            }
        }

        var freedSessions = new List<Guid>();
        foreach (var (session, survivors, survivorStatus, mergedBooking, mergedStatus) in pairs)
        {
            var (loser, loserStatus) = Rank(mergedStatus) > Rank(survivorStatus) ? (survivors, survivorStatus) : (mergedBooking, mergedStatus);
            var placeHeld = loserStatus is not "waitlisted";
            await ExecuteAsync(
                unitOfWork,
                "UPDATE scheduling.bookings SET status = $3, cancel_reason = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                cancellationToken,
                org, loser, loserStatus is "attended" or "no_show" ? "removed" : "cancelled", loserStatus is "attended" or "no_show" ? null : "staff");
            if (placeHeld)
            {
                await ExecuteAsync(unitOfWork, "UPDATE scheduling.sessions SET booked_count = booked_count - 1, version = version + 1 WHERE organization_id = $1 AND id = $2", cancellationToken, org, session);
                freedSessions.Add(session);
            }

            // One person, one class, one entry: the weaker place's entry always returns.
            await ExecuteAsync(
                unitOfWork,
                """
                WITH used AS (
                    UPDATE scheduling.pass_uses SET status = 'returned', updated_at = now(), version = version + 1
                    WHERE organization_id = $1 AND booking_id = $2 AND status = 'held'
                    RETURNING pass_id
                )
                UPDATE scheduling.passes p SET entries_used = p.entries_used - 1, updated_at = now(), version = p.version + 1
                FROM used WHERE p.organization_id = $1 AND p.id = used.pass_id AND p.entries IS NOT NULL
                """,
                cancellationToken,
                org, loser);
            await AuditAsync(unitOfWork, tenant, loserStatus is "attended" or "no_show" ? "booking.removed" : "booking.cancelled", "booking", loser, new { sessionId = session, reason = "person_merged" }, cancellationToken);
        }

        await ExecuteAsync(unitOfWork, "UPDATE scheduling.bookings SET person_id = $2, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);
        await ExecuteAsync(unitOfWork, "UPDATE scheduling.passes SET person_id = $2, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);
        await ExecuteAsync(unitOfWork, "UPDATE notifications.inbox_items SET person_id = $2 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);

        foreach (var session in freedSessions.Distinct())
        {
            await BookingService.PromoteSessionAsync(unitOfWork, tenant, session, now, cancellationToken);
        }
    }

    private static int Rank(string status) => status switch
    {
        "attended" => 4,
        "no_show" => 3,
        "booked" => 2,
        _ => 1
    };

    private static async Task ExecuteAsync(UnitOfWork unitOfWork, string sql, CancellationToken cancellationToken, params object?[] parameters)
    {
        await using var command = unitOfWork.Command(sql, parameters);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record CandidateRow(Guid Id, string Reason, string Status, Guid PersonA, Guid PersonB, DateTimeOffset CreatedAt, long Version);

    private static async Task<List<CandidateRow>> ReadCandidateRowsAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var rows = new List<CandidateRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new CandidateRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetGuid(3),
                reader.GetGuid(4),
                await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken),
                reader.GetInt64(6)));
        }

        return rows;
    }

    private static async Task<DuplicateCandidateView> WithPeopleAsync(UnitOfWork unitOfWork, Guid organizationId, CandidateRow row, CancellationToken cancellationToken) =>
        new(
            row.Id,
            row.Reason,
            row.Status,
            (await PeopleService.DetailAsync(unitOfWork, organizationId, row.PersonA, cancellationToken)).Person,
            (await PeopleService.DetailAsync(unitOfWork, organizationId, row.PersonB, cancellationToken)).Person,
            row.CreatedAt,
            row.Version);

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, string targetType, Guid targetId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, targetType, targetId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}
