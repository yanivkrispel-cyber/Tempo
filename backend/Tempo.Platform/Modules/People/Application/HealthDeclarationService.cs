using System.Text.Json;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.People.Domain;
using Tempo.Platform.Modules.People.Infrastructure;

namespace Tempo.Platform.Modules.People.Application;

/// <summary>Status and dates of a person's current declaration; never answers or names (docs/31 section 4).</summary>
public sealed record HealthStatusView(string Status, Guid? DeclarationId, int? FormVersion, string? SignerRole, DateTimeOffset? SignedAt, DateTimeOffset? ExpiresAt, DateOnly? MedicalApprovalOn)
{
    public static readonly HealthStatusView Missing = new(HealthStatus.Missing, null, null, null, null, null, null);
}

public sealed record MyHealthDeclarationView(HealthStatusView Declaration, HealthForm Form, bool Required);

public sealed record HealthAnswerView(string QuestionId, bool Answer);

public sealed record HealthAnswersView(
    Guid DeclarationId,
    string Status,
    HealthForm Form,
    IReadOnlyList<HealthAnswerView> Answers,
    string SignedName,
    string SignerRole,
    string? GuardianName,
    DateTimeOffset SignedAt,
    DateTimeOffset ExpiresAt,
    DateOnly? MedicalApprovalOn);

/// <summary><paramref name="SignedName"/> is the member's full name; <paramref name="GuardianName"/> the guardian who signs for them.</summary>
public sealed record NewHealthDeclaration(int FormVersion, IReadOnlyList<HealthAnswerView> Answers, string? SignedName, string? SignerRole, string? GuardianName, bool Confirmed);

/// <summary>The four statuses (H-3), computed from the current row and the clock; nothing flips a column at midnight.</summary>
public static class HealthStatus
{
    public const string Missing = "missing";
    public const string SignedStatus = "signed";
    public const string NeedsMedicalApproval = "needs_medical_approval";
    public const string Expired = "expired";

    public static string Of(DateTimeOffset expiresAt, bool hasYes, DateOnly? medicalApprovalOn, DateTimeOffset now)
    {
        if (expiresAt <= now)
        {
            return Expired;
        }

        return hasYes && medicalApprovalOn is null ? NeedsMedicalApproval : SignedStatus;
    }

    /// <summary>The status of <paramref name="personId"/>'s current declaration; for the booking gate and the roster.</summary>
    public static async Task<string> OfPersonAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT expires_at, has_yes, medical_approval_on FROM people.health_declarations WHERE organization_id = $1 AND person_id = $2 AND superseded_at IS NULL",
            organizationId, personId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return Missing;
        }

        return Of(
            await reader.GetFieldValueAsync<DateTimeOffset>(0, cancellationToken),
            reader.GetBoolean(1),
            await reader.IsDBNullAsync(2, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(2, cancellationToken),
            now);
    }
}

/// <summary>
/// The health declaration (docs/31): the member signs for themselves or a guardian signs for them; staff with
/// `people.view` read the status; `health.view` reads the answers (each read audited, no content) and records a
/// medical approval. Answers and names are encrypted before they reach the database (ADR-0026); permission checks
/// for the staff routes are the API's (`RequirePermission`).
/// </summary>
public interface IHealthDeclarationService
{
    Task<MyHealthDeclarationView> GetMineAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<MyHealthDeclarationView> SignMineAsync(TenantContext tenant, NewHealthDeclaration declaration, CancellationToken cancellationToken);

    Task<HealthStatusView> GetStatusAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);

    Task<HealthAnswersView> GetAnswersAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);

    Task<HealthStatusView> RecordMedicalApprovalAsync(TenantContext tenant, Guid personId, DateOnly approvedOn, CancellationToken cancellationToken);
}

public sealed class HealthDeclarationService(IDataSourceProvider dataSources, TimeProvider clock, IHealthDataKeys keys) : IHealthDeclarationService
{
    public const int ValidMonths = 12;

    internal const string AnswersColumn = "answers_ciphertext";
    internal const string SignedNameColumn = "signed_name_ciphertext";
    internal const string GuardianNameColumn = "guardian_name_ciphertext";

    private const string Columns = "id, form_version, signer_role, has_yes, signed_at, expires_at, medical_approval_on, key_version, answers_ciphertext, signed_name_ciphertext, guardian_name_ciphertext";

    public async Task<MyHealthDeclarationView> GetMineAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        return await MineAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
    }

    public async Task<MyHealthDeclarationView> SignMineAsync(TenantContext tenant, NewHealthDeclaration declaration, CancellationToken cancellationToken)
    {
        if (!declaration.Confirmed)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "health.confirmation_required", "Confirm the declaration before signing.", "confirmed");
        }

        if (declaration.SignerRole is not ("self" or "guardian"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "signerRole.invalid", "Say who signs: the member or a guardian.", "signerRole");
        }

        var signedName = Name(declaration.SignedName, "signedName", "health.signed_name_invalid");
        var guardianName = declaration.SignerRole == "guardian"
            ? Name(declaration.GuardianName, "guardianName", "health.guardian_name_required")
            : null;
        var form = HealthForms.Current;
        if (declaration.FormVersion != form.Version)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "health.form_version_stale", "The form changed. Reload it and sign again.");
        }

        var answers = Answers(form, declaration.Answers);

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        var version = keys.CurrentVersion;
        var key = await keys.GetAsync(version, cancellationToken);
        var id = Guid.CreateVersion7();
        var now = clock.GetUtcNow();
        var org = tenant.OrganizationId;

        await using (var supersede = unitOfWork.Command(
            "UPDATE people.health_declarations SET superseded_at = $3 WHERE organization_id = $1 AND person_id = $2 AND superseded_at IS NULL",
            org, person, now))
        {
            await supersede.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO people.health_declarations
                (organization_id, id, person_id, form_version, signer_role, has_yes, signed_at, expires_at, key_version,
                 answers_ciphertext, signed_name_ciphertext, guardian_name_ciphertext, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $7)
            """,
            org,
            id,
            person,
            form.Version,
            declaration.SignerRole,
            answers.Values.Any(answer => answer),
            now,
            now.AddMonths(ValidMonths),
            version,
            HealthCipher.Encrypt(key, JsonSerializer.Serialize(answers), new HealthField(org, id, AnswersColumn, version)),
            HealthCipher.Encrypt(key, signedName, new HealthField(org, id, SignedNameColumn, version)),
            guardianName is null ? null : HealthCipher.Encrypt(key, guardianName, new HealthField(org, id, GuardianNameColumn, version))))
        {
            try
            {
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");
            }
        }

        await AuditAsync(unitOfWork, tenant, "health.declaration.signed", id, new { declarationId = id, formVersion = form.Version, signerRole = declaration.SignerRole }, cancellationToken);
        var view = await MineAsync(unitOfWork, org, person, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    public async Task<HealthStatusView> GetStatusAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await PersonExistsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        return (await CurrentAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken))?.Status(clock.GetUtcNow()) ?? HealthStatusView.Missing;
    }

    public async Task<HealthAnswersView> GetAnswersAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await PersonExistsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var row = await CurrentAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken)
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "health.declaration_not_found", "This person has not signed a health declaration.");
        var view = await OpenAsync(keys, tenant.OrganizationId, row, clock.GetUtcNow(), cancellationToken);
        await AuditAsync(unitOfWork, tenant, "health.declaration.viewed", row.Id, new { declarationId = row.Id, purpose = "view" }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    public async Task<HealthStatusView> RecordMedicalApprovalAsync(TenantContext tenant, Guid personId, DateOnly approvedOn, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await PersonExistsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        var now = clock.GetUtcNow();
        var row = await CurrentAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken, forUpdate: true);
        if (row is null || row.Status(now).Status != HealthStatus.NeedsMedicalApproval)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "health.no_approval_needed", "This declaration does not wait for a medical approval.");
        }

        // Dates are the studio's: an approval on the signing day after 21:00 UTC is still that day in Israel.
        var zone = await StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
        var signedOn = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(row.SignedAt, zone).DateTime);
        if (approvedOn > today || approvedOn < signedOn)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "approvedOn.invalid", "The approval date is between the signing day and today.", "approvedOn");
        }

        await using (var update = unitOfWork.Command(
            "UPDATE people.health_declarations SET medical_approval_on = $3, medical_approval_by = $4 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId, row.Id, approvedOn, tenant.MembershipId))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "health.medical_approval.recorded", row.Id, new { declarationId = row.Id, approvedOn }, cancellationToken);
        var view = (await CurrentAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken))!.Status(now);
        await unitOfWork.CommitAsync(cancellationToken);
        return view;
    }

    /// <summary>Every declaration of a person, current and replaced, oldest first (export, docs/31 section 11).</summary>
    internal static async Task<IReadOnlyList<DeclarationRow>> AllAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            $"SELECT {Columns}, superseded_at FROM people.health_declarations WHERE organization_id = $1 AND person_id = $2 ORDER BY signed_at, id",
            organizationId, personId);
        return await ReadAsync(command, cancellationToken);
    }

    /// <summary>Decrypts one declaration with the key version it was written with; fails closed.</summary>
    internal static async Task<HealthAnswersView> OpenAsync(IHealthDataKeys keys, Guid organizationId, DeclarationRow row, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var key = await keys.GetAsync(row.KeyVersion, cancellationToken);
        var form = HealthForms.Find(row.FormVersion) ?? throw HealthDataKeys.Unavailable();
        var answers = JsonSerializer.Deserialize<Dictionary<string, bool>>(HealthCipher.Decrypt(key, row.Answers, new HealthField(organizationId, row.Id, AnswersColumn, row.KeyVersion)))
            ?? throw HealthDataKeys.Unavailable();
        var signedName = HealthCipher.Decrypt(key, row.SignedName, new HealthField(organizationId, row.Id, SignedNameColumn, row.KeyVersion));
        var guardianName = row.GuardianName is null ? null : HealthCipher.Decrypt(key, row.GuardianName, new HealthField(organizationId, row.Id, GuardianNameColumn, row.KeyVersion));
        return new HealthAnswersView(
            row.Id,
            row.Status(now).Status,
            form,
            [.. form.Questions.Where(question => answers.ContainsKey(question.Id)).Select(question => new HealthAnswerView(question.Id, answers[question.Id]))],
            signedName,
            row.SignerRole,
            guardianName,
            row.SignedAt,
            row.ExpiresAt,
            row.MedicalApprovalOn);
    }

    private async Task<MyHealthDeclarationView> MineAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, CancellationToken cancellationToken)
    {
        var status = (await CurrentAsync(unitOfWork, organizationId, person, cancellationToken))?.Status(clock.GetUtcNow()) ?? HealthStatusView.Missing;
        await using var required = unitOfWork.Command(
            "SELECT coalesce((SELECT require_health_declaration FROM scheduling.booking_policies WHERE organization_id = $1), false)",
            organizationId);
        return new MyHealthDeclarationView(status, HealthForms.Current, (bool)(await required.ExecuteScalarAsync(cancellationToken))!);
    }

    private static async Task<DeclarationRow?> CurrentAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken, bool forUpdate = false)
    {
        await using var command = unitOfWork.Command(
            $"SELECT {Columns}, superseded_at FROM people.health_declarations WHERE organization_id = $1 AND person_id = $2 AND superseded_at IS NULL{(forUpdate ? " FOR UPDATE" : string.Empty)}",
            organizationId, personId);
        return (await ReadAsync(command, cancellationToken)).SingleOrDefault();
    }

    private static async Task<IReadOnlyList<DeclarationRow>> ReadAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var rows = new List<DeclarationRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new DeclarationRow(
                reader.GetGuid(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetBoolean(3),
                await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken),
                await reader.GetFieldValueAsync<DateTimeOffset>(5, cancellationToken),
                await reader.IsDBNullAsync(6, cancellationToken) ? null : await reader.GetFieldValueAsync<DateOnly>(6, cancellationToken),
                reader.GetInt32(7),
                await reader.GetFieldValueAsync<byte[]>(8, cancellationToken),
                await reader.GetFieldValueAsync<byte[]>(9, cancellationToken),
                await reader.IsDBNullAsync(10, cancellationToken) ? null : await reader.GetFieldValueAsync<byte[]>(10, cancellationToken),
                await reader.IsDBNullAsync(11, cancellationToken) ? null : await reader.GetFieldValueAsync<DateTimeOffset>(11, cancellationToken)));
        }

        return rows;
    }

    /// <summary>One answer per question of the form, and nothing else (H-2).</summary>
    private static Dictionary<string, bool> Answers(HealthForm form, IReadOnlyList<HealthAnswerView>? given)
    {
        var answers = new Dictionary<string, bool>(StringComparer.Ordinal);
        if ((given ?? []).Any(answer => !form.Questions.Any(question => question.Id == answer.QuestionId) || !answers.TryAdd(answer.QuestionId, answer.Answer)))
        {
            throw Incomplete();
        }

        return answers.Count == form.Questions.Count ? form.Questions.ToDictionary(question => question.Id, question => answers[question.Id], StringComparer.Ordinal) : throw Incomplete();

        static DomainRuleViolationException Incomplete() =>
            new(ViolationKind.Validation, "health.answers_incomplete", "Answer every question yes or no.", "answers");
    }

    private static string Name(string? value, string field, string code)
    {
        var name = value?.Trim() ?? string.Empty;
        return name.Length is < 2 or > 100 || name.Any(char.IsControl)
            ? throw new DomainRuleViolationException(ViolationKind.Validation, code, "Write a full name of 2 to 100 characters.", field)
            : name;
    }

    private static async Task<Guid> MyPersonIdAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2 AND status = 'active'",
            tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid id
            ? id
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Your record in this studio was not found.");
    }

    private static async Task PersonExistsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2", organizationId, personId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw PeopleService.PersonNotFound();
        }
    }

    private static async Task<TimeZoneInfo> StudioZoneAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT time_zone FROM organizations.organizations WHERE id = $1", organizationId);
        return TimeZoneInfo.FindSystemTimeZoneById(await command.ExecuteScalarAsync(cancellationToken) as string ?? "Asia/Jerusalem");
    }

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, Guid declarationId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, "health_declaration", declarationId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

/// <summary>A declaration row as stored: the ciphertext stays bytes until <see cref="HealthDeclarationService.OpenAsync"/>.</summary>
internal sealed record DeclarationRow(
    Guid Id,
    int FormVersion,
    string SignerRole,
    bool HasYes,
    DateTimeOffset SignedAt,
    DateTimeOffset ExpiresAt,
    DateOnly? MedicalApprovalOn,
    int KeyVersion,
    byte[] Answers,
    byte[] SignedName,
    byte[]? GuardianName,
    DateTimeOffset? SupersededAt)
{
    public HealthStatusView Status(DateTimeOffset now) =>
        new(HealthStatus.Of(ExpiresAt, HasYes, MedicalApprovalOn, now), Id, FormVersion, SignerRole, SignedAt, ExpiresAt, MedicalApprovalOn);
}
