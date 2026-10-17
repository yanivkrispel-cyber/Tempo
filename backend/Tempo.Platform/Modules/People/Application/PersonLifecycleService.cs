using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Media;
using Tempo.Platform.Modules.People.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Platform.Modules.People.Application;

public sealed record DuplicateCandidateView(Guid Id, string Reason, string Status, PersonView PersonA, PersonView PersonB, DateTimeOffset CreatedAt, long Version);

public sealed record DuplicateCandidatePage(IReadOnlyList<DuplicateCandidateView> Items, Guid? NextBefore);

/// <summary>One booking as the data subject sees it in their export: the class, when, and what became of the place.</summary>
public sealed record ExportBookingView(Guid Id, Guid SessionId, string ClassName, DateTimeOffset StartsAt, string Status, bool LateCancel, string? CancelReason, DateTimeOffset CreatedAt);

/// <summary>One pass in the export; no note, because erase clears it and the export is about the person, not staff remarks.</summary>
public sealed record ExportPassView(Guid Id, string ProductName, string Kind, DateOnly StartsOn, DateOnly EndsOn, int? Entries, int EntriesUsed, string Status, DateTimeOffset CreatedAt);

public sealed record PersonExportView(
    DateTimeOffset ExportedAt,
    Guid OrganizationId,
    string OrganizationName,
    PersonDetailView Person,
    IReadOnlyList<ConsentView> ConsentHistory,
    IReadOnlyList<ExportBookingView> Bookings,
    IReadOnlyList<ExportPassView> Passes,
    IReadOnlyList<ExportHealthDeclarationView> HealthDeclarations,
    bool HealthAnswersWithheld,
    string? HealthAnswersWithheldReason = null,
    IReadOnlyList<BuddyView>? Buddies = null)
{
    /// <summary>The exporter lacks `health.view`.</summary>
    public const string NoHealthView = "no_health_view";

    /// <summary>The health data key could not be read (A-5): the rest of the export still goes out.</summary>
    public const string HealthKeyUnavailable = "health_key_unavailable";
}

/// <summary>One health declaration in the export; answers and names are null when the exporter lacks `health.view`.</summary>
public sealed record ExportHealthDeclarationView(
    Guid DeclarationId,
    int FormVersion,
    string Status,
    string SignerRole,
    DateTimeOffset SignedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? SupersededAt,
    DateOnly? MedicalApprovalOn,
    IReadOnlyList<HealthAnswerView>? Answers,
    string? SignedName,
    string? GuardianName);

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

public sealed class PersonLifecycleService(IDataSourceProvider dataSources, TimeProvider clock, IHealthDataKeys? healthKeys = null, IMediaStore? mediaStore = null) : IPersonLifecycleService
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

        // The person's bookings and passes belong in the export (docs/29 section 7, #124): what they booked, what
        // became of it, and the cards and memberships they hold or held. Ids only, plus the class and product names.
        var bookings = new List<ExportBookingView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT b.id, b.session_id, ct.name, s.starts_at, b.status, b.late_cancel, b.cancel_reason, b.created_at
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            WHERE b.organization_id = $1 AND b.person_id = $2
            ORDER BY s.starts_at, b.id
            """,
            tenant.OrganizationId,
            personId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                bookings.Add(new ExportBookingView(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetString(2),
                    await reader.GetFieldValueAsync<DateTimeOffset>(3, cancellationToken),
                    reader.GetString(4),
                    reader.GetBoolean(5),
                    await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetString(6),
                    await reader.GetFieldValueAsync<DateTimeOffset>(7, cancellationToken)));
            }
        }

        var passes = new List<ExportPassView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT ps.id, pp.name, pp.kind, ps.starts_on, ps.ends_on, ps.entries, ps.entries_used, ps.status, ps.created_at
            FROM scheduling.passes ps
            JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
            WHERE ps.organization_id = $1 AND ps.person_id = $2
            ORDER BY ps.starts_on, ps.id
            """,
            tenant.OrganizationId,
            personId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                passes.Add(new ExportPassView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    await reader.GetFieldValueAsync<DateOnly>(3, cancellationToken),
                    await reader.GetFieldValueAsync<DateOnly>(4, cancellationToken),
                    await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetInt32(5),
                    reader.GetInt32(6),
                    reader.GetString(7),
                    await reader.GetFieldValueAsync<DateTimeOffset>(8, cancellationToken)));
            }
        }

        // Buddies are the person's own choice, so they are part of what we hold about them (docs/33 section 4.2).
        var buddies = new List<BuddyView>();
        await using (var command = unitOfWork.Command(
            """
            SELECT p.id, p.display_name, l.created_at
            FROM people.buddy_links l
            JOIN people.people p ON p.organization_id = l.organization_id AND p.id = CASE WHEN l.person_low = $2 THEN l.person_high ELSE l.person_low END
            WHERE l.organization_id = $1 AND (l.person_low = $2 OR l.person_high = $2)
            ORDER BY l.created_at
            """,
            tenant.OrganizationId,
            personId))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                buddies.Add(new BuddyView(reader.GetGuid(0), reader.GetString(1), await reader.GetFieldValueAsync<DateTimeOffset>(2, cancellationToken)));
            }
        }

        string organizationName;
        await using (var org = unitOfWork.Command("SELECT display_name FROM organizations.organizations WHERE id = $1", tenant.OrganizationId))
        {
            organizationName = (string)(await org.ExecuteScalarAsync(cancellationToken))!;
        }

        // Health declarations (docs/31 section 11): decrypted only for an exporter who holds health.view, each
        // decrypted one audited as a view with purpose export; otherwise listed without answers or names. When the
        // key can't be read (A-5, docs/32 section 11) every answer is withheld, nothing is audited as viewed, and the
        // rest of the export still goes out.
        var now = clock.GetUtcNow();
        var reason = tenant.Has(Permissions.HealthView) ? null : PersonExportView.NoHealthView;
        var rows = await HealthDeclarationService.AllAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var opened = new Dictionary<Guid, HealthAnswersView>();
        if (reason is null)
        {
            try
            {
                foreach (var row in rows)
                {
                    opened[row.Id] = await HealthDeclarationService.OpenAsync(healthKeys ?? throw HealthDataKeys.Unavailable(), tenant.OrganizationId, row, now, cancellationToken);
                }
            }
            catch (DomainRuleViolationException e) when (e.Code == HealthDataKeys.Unavailable().Code)
            {
                opened.Clear();
                reason = PersonExportView.HealthKeyUnavailable;
            }
        }

        var declarations = new List<ExportHealthDeclarationView>();
        foreach (var row in rows)
        {
            var answers = opened.GetValueOrDefault(row.Id);
            if (answers is not null)
            {
                await AuditAsync(unitOfWork, tenant, "health.declaration.viewed", "health_declaration", row.Id, new { declarationId = row.Id, purpose = "export" }, cancellationToken);
            }

            declarations.Add(new ExportHealthDeclarationView(
                row.Id,
                row.FormVersion,
                row.Status(now).Status,
                row.SignerRole,
                row.SignedAt,
                row.ExpiresAt,
                row.SupersededAt,
                row.MedicalApprovalOn,
                answers?.Answers,
                answers?.SignedName,
                answers?.GuardianName));
        }

        await AuditAsync(unitOfWork, tenant, "person.exported", "person", personId, new { }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new PersonExportView(now, tenant.OrganizationId, organizationName, detail, history, bookings, passes, declarations, reason is not null, reason, buddies);
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
        await CancelUpcomingBookingsAsync(unitOfWork, tenant, personId, clock.GetUtcNow(), cancellationToken);
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
        // The member's own monthly goal goes (docs/31 section 12).
        await ExecuteAsync(unitOfWork, "DELETE FROM scheduling.member_goals WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, personId);
        // So does the usual spot in each room (docs/33 section 3).
        await ExecuteAsync(unitOfWork, "DELETE FROM scheduling.spot_preferences WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, personId);
        // Buddy codes, links and wrong guesses go (docs/33 section 4.2).
        await BuddyService.ForgetAsync(unitOfWork, org, personId, cancellationToken);
        // The avatar goes (docs/33 section 6.3); its objects are deleted once the erase commits.
        var avatarKeys = await MediaService.ForgetAvatarAsync(unitOfWork, org, personId, cancellationToken);
        await ExecuteAsync(unitOfWork, "UPDATE people.people SET avatar_media_id = NULL WHERE organization_id = $1 AND id = $2", cancellationToken, org, personId);
        // Every health declaration goes, current and replaced (docs/31 section 11); the audit keeps the count only.
        int healthDeclarations;
        await using (var deleteHealth = unitOfWork.Command("DELETE FROM people.health_declarations WHERE organization_id = $1 AND person_id = $2", org, personId))
        {
            healthDeclarations = await deleteHealth.ExecuteNonQueryAsync(cancellationToken);
        }
        // Class messages reach the person through inbox items that point at the text (docs/29 section 16.2); the
        // pointers go, the studio's message row (ids only) stays.
        await ExecuteAsync(unitOfWork, "DELETE FROM notifications.inbox_items WHERE organization_id = $1 AND person_id = $2 AND kind = 'session.message'", cancellationToken, org, personId);
        // Preferences, quiet hours, push subscriptions and delivery requests go (docs/30 section 7); deliveries go
        // with their requests, and the remaining inbox items lose the link.
        await DeleteNotificationRowsAsync(unitOfWork, org, personId, cancellationToken);

        // Consent rows stay as proof: they hold states, timestamps and text versions, never names or contacts.
        // The reason is required but not kept: free text can name the person, and person.* audit data never
        // holds names (section 7; review on #77).
        await AuditAsync(unitOfWork, tenant, "person.erased", "person", personId, new { reasonGiven = true, healthDeclarations }, cancellationToken);
        var erased = await PeopleService.DetailAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        if (mediaStore is not null)
        {
            await mediaStore.DeleteAsync(avatarKeys, cancellationToken);
        }

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
            await BookingService.ReturnEntryAsync(unitOfWork, org, loser, cancellationToken);
            await AuditAsync(unitOfWork, tenant, loserStatus is "attended" or "no_show" ? "booking.removed" : "booking.cancelled", "booking", loser, new { sessionId = session, reason = "person_merged" }, cancellationToken);
        }

        await ExecuteAsync(unitOfWork, "UPDATE scheduling.bookings SET person_id = $2, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);
        await ExecuteAsync(unitOfWork, "UPDATE scheduling.passes SET person_id = $2, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);
        await ExecuteAsync(unitOfWork, "UPDATE notifications.inbox_items SET person_id = $2 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);
        // The survivor keeps its own monthly goal (docs/31 section 12); the merged record's goes.
        await ExecuteAsync(unitOfWork, "DELETE FROM scheduling.member_goals WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, merged);
        // The survivor keeps its usual spots; the merged record's go.
        await ExecuteAsync(unitOfWork, "DELETE FROM scheduling.spot_preferences WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, merged);
        // So do its buddies: a link was a consent between two records, and the survivor gave none.
        await BuddyService.ForgetAsync(unitOfWork, org, merged, cancellationToken);
        // Health declarations follow the survivor (their ciphertext is bound to the declaration, not the person). Of
        // two current ones, the newer signature stays current and the older is replaced (docs/31 section 11).
        await ExecuteAsync(
            unitOfWork,
            """
            UPDATE people.health_declarations d SET superseded_at = $4
            WHERE d.organization_id = $1 AND d.superseded_at IS NULL AND d.person_id IN ($2, $3)
              AND d.id <> (SELECT c.id FROM people.health_declarations c
                           WHERE c.organization_id = $1 AND c.superseded_at IS NULL AND c.person_id IN ($2, $3)
                           ORDER BY c.signed_at DESC, c.id DESC LIMIT 1)
            """,
            cancellationToken,
            org, survivor, merged, now);
        await ExecuteAsync(unitOfWork, "UPDATE people.health_declarations SET person_id = $2 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);
        // The survivor keeps its own notification preferences and devices; the merged record's go, with its
        // delivery history (the inbox items above moved and keep showing).
        await DeleteNotificationRowsAsync(unitOfWork, org, merged, cancellationToken);

        // Invitations follow the survivor, so erasing it later scrubs their emails too (#101). A pending one was
        // meant to link a login to the merged record, which is gone: it is revoked, and staff invite the survivor.
        var revokedInvitations = new List<Guid>();
        await using (var revoke = unitOfWork.Command(
            """
            UPDATE organizations.invitations
            SET status = 'revoked', updated_at = now(), version = version + 1
            WHERE organization_id = $1 AND person_id = $2 AND status = 'pending'
            RETURNING id
            """,
            org,
            merged))
        {
            await using var reader = await revoke.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                revokedInvitations.Add(reader.GetGuid(0));
            }
        }

        foreach (var id in revokedInvitations)
        {
            await AuditAsync(unitOfWork, tenant, "invitation.revoked", "invitation", id, new { reason = "person_merged" }, cancellationToken);
        }

        await ExecuteAsync(unitOfWork, "UPDATE organizations.invitations SET person_id = $2, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $3", cancellationToken, org, survivor, merged);

        foreach (var session in freedSessions.Distinct())
        {
            await BookingService.PromoteSessionAsync(unitOfWork, tenant, session, now, cancellationToken);
        }
    }

    /// <summary>
    /// An erased person keeps no place in a class that has not started (#191): each booked or waiting place is
    /// cancelled by staff with no late charge, its held entry returns, and a freed seat goes to the waitlist as on
    /// any cancel. The erased person is not notified. Past bookings and attendance stay as anonymised history.
    /// </summary>
    private static async Task CancelUpcomingBookingsAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid personId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var org = tenant.OrganizationId;
        var upcoming = new List<(Guid Booking, Guid Session, string Status)>();
        await using (var read = unitOfWork.Command(
            """
            SELECT b.id, b.session_id, b.status
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status IN ('booked', 'waitlisted') AND s.starts_at > $3
            FOR UPDATE OF b
            """,
            org, personId, now))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                upcoming.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2)));
            }
        }

        var freedSessions = new List<Guid>();
        foreach (var (booking, session, status) in upcoming)
        {
            await ExecuteAsync(
                unitOfWork,
                "UPDATE scheduling.bookings SET status = 'cancelled', cancel_reason = 'staff', late_cancel = false, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
                cancellationToken,
                org, booking);
            if (status == "booked")
            {
                await ExecuteAsync(unitOfWork, "UPDATE scheduling.sessions SET booked_count = booked_count - 1, version = version + 1 WHERE organization_id = $1 AND id = $2", cancellationToken, org, session);
                freedSessions.Add(session);
            }

            await BookingService.ReturnEntryAsync(unitOfWork, org, booking, cancellationToken);
            await AuditAsync(unitOfWork, tenant, "booking.cancelled", "booking", booking, new { sessionId = session, reason = "person_erased" }, cancellationToken);
        }

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

    private static async Task DeleteNotificationRowsAsync(UnitOfWork unitOfWork, Guid org, Guid personId, CancellationToken cancellationToken)
    {
        foreach (var table in new[]
        {
            "notifications.preferences", "notifications.quiet_hours", "notifications.reminder_switches",
            "notifications.preference_versions", "notifications.push_subscriptions", "notifications.requests"
        })
        {
            await ExecuteAsync(unitOfWork, $"DELETE FROM {table} WHERE organization_id = $1 AND person_id = $2", cancellationToken, org, personId);
        }
    }
}
