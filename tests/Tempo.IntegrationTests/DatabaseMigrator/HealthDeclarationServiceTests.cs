using System.Security.Cryptography;
using System.Text;
using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Domain;
using Tempo.Platform.Modules.People.Infrastructure;
using Tempo.Platform.Modules.Retention.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The health declaration (docs/31) on PostgreSQL 18: ciphertext only in the row, fail closed on the wrong key,
/// statuses and expiry, medical approval, the booking gate on and off, the roster status, audit without content,
/// export with and without `health.view`, erase, merge and retention. Every name and answer here is generic.
/// </summary>
public sealed class HealthDeclarationServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string MemberName = "שם לדוגמה";
    private const string GuardianName = "אפוטרופוס לדוגמה";

    private static readonly string KeyV1 = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    [Fact]
    public async Task Signing_StoresCiphertextOnly_AndAnswersOpenForHealthView()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var health = Service(db);

        var signed = await health.SignMineAsync(studio.Member, Declaration(yesOn: null, guardian: true), CancellationToken.None);

        signed.Declaration.Status.Should().Be(HealthStatus.SignedStatus);
        signed.Declaration.SignerRole.Should().Be("guardian");
        var (text, decoded) = await RawRowAsync(db);
        foreach (var plaintext in new[] { MemberName, GuardianName, "q1", "false" })
        {
            text.Should().NotContain(plaintext, "no column holds an answer or a name in plain text");
        }

        // The ciphertext's bytes read as text: only markers long enough that random bytes can't spell them (two
        // letters did, once in a few hundred runs, on #422's CI).
        foreach (var plaintext in new[] { MemberName, GuardianName, "\"q1\":" })
        {
            decoded.Should().NotContain(plaintext, "no ciphertext column holds an answer or a name in plain text");
        }

        var answers = await health.GetAnswersAsync(studio.Owner, studio.Person, CancellationToken.None);
        answers.SignedName.Should().Be(MemberName);
        answers.GuardianName.Should().Be(GuardianName);
        answers.Answers.Should().HaveCount(HealthForms.V1.Questions.Count).And.OnlyContain(a => !a.Answer);
    }

    [Fact]
    public async Task AWrongKeyVersion_OrAnotherKey_FailsClosed()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(), CancellationToken.None);

        var otherKey = new HealthDeclarationService(db, TimeProvider.System, Keys(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))));
        var withOtherKey = () => otherKey.GetAnswersAsync(studio.Owner, studio.Person, CancellationToken.None);
        (await withOtherKey.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("health.key_unavailable");

        await db.AsMasterAsync("UPDATE people.health_declarations SET key_version = 2");
        var wrongVersion = () => Service(db).GetAnswersAsync(studio.Owner, studio.Person, CancellationToken.None);
        (await wrongVersion.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("health.key_unavailable");

        // The front desk keeps working: the status needs no key.
        (await otherKey.GetStatusAsync(studio.Owner, studio.Person, CancellationToken.None)).Status.Should().Be(HealthStatus.SignedStatus);
    }

    [Fact]
    public async Task TheAudit_RecordsSigningAndEveryRead_WithoutContent()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var health = Service(db);
        await health.SignMineAsync(studio.Member, Declaration(yesOn: "q2", guardian: true), CancellationToken.None);
        await health.GetAnswersAsync(studio.Owner, studio.Person, CancellationToken.None);
        await health.GetAnswersAsync(studio.Owner, studio.Person, CancellationToken.None);

        var audit = (string)(await db.AsMasterAsync("SELECT string_agg(action || ' ' || data::text, E'\\n') FROM audit.audit_events WHERE action LIKE 'health.%'"))!;

        audit.Split('\n').Count(line => line.StartsWith("health.declaration.viewed", StringComparison.Ordinal)).Should().Be(2);
        audit.Should().Contain("health.declaration.signed");
        audit.Should().NotContain(MemberName).And.NotContain(GuardianName).And.NotContain("q2").And.NotContain("answers");
    }

    [Fact]
    public async Task AnyYes_NeedsMedicalApproval_UntilOneIsRecorded()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var health = Service(db);

        (await health.SignMineAsync(studio.Member, Declaration(yesOn: "q3"), CancellationToken.None)).Declaration.Status
            .Should().Be(HealthStatus.NeedsMedicalApproval);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime);

        var tomorrow = () => health.RecordMedicalApprovalAsync(studio.Owner, studio.Person, today.AddDays(1), CancellationToken.None);
        (await tomorrow.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("approvedOn.invalid");

        var approved = await health.RecordMedicalApprovalAsync(studio.Owner, studio.Person, today, CancellationToken.None);
        approved.Status.Should().Be(HealthStatus.SignedStatus);
        approved.MedicalApprovalOn.Should().Be(today);

        var again = () => health.RecordMedicalApprovalAsync(studio.Owner, studio.Person, today, CancellationToken.None);
        (await again.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("health.no_approval_needed");
    }

    [Fact]
    public async Task AnApprovalOnTheSigningDay_After21Utc_IsTheSameDayInIsrael()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);

        // Signed 2026-10-17 at 21:30 UTC, which is 00:30 on 2026-10-18 in Israel (+03:00).
        var signedAt = new DateTimeOffset(2026, 10, 17, 21, 30, 0, TimeSpan.Zero);
        await new HealthDeclarationService(db, new FixedClock(signedAt), Keys(KeyV1)).SignMineAsync(studio.Member, Declaration(yesOn: "q1"), CancellationToken.None);
        var later = new HealthDeclarationService(db, new FixedClock(signedAt.AddMinutes(20)), Keys(KeyV1));

        var dayBefore = () => later.RecordMedicalApprovalAsync(studio.Owner, studio.Person, new DateOnly(2026, 10, 17), CancellationToken.None);
        (await dayBefore.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("approvedOn.invalid");
        (await later.RecordMedicalApprovalAsync(studio.Owner, studio.Person, new DateOnly(2026, 10, 18), CancellationToken.None)).Status
            .Should().Be(HealthStatus.SignedStatus);
    }

    [Fact]
    public async Task ADeclaration_ExpiresTwelveMonthsAfterSigning()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var signedAt = new DateTimeOffset(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);
        await new HealthDeclarationService(db, new FixedClock(signedAt), Keys(KeyV1)).SignMineAsync(studio.Member, Declaration(), CancellationToken.None);

        (await new HealthDeclarationService(db, new FixedClock(signedAt.AddMonths(12).AddSeconds(-1)), Keys(KeyV1)).GetStatusAsync(studio.Owner, studio.Person, CancellationToken.None))
            .Status.Should().Be(HealthStatus.SignedStatus);
        (await new HealthDeclarationService(db, new FixedClock(signedAt.AddMonths(12)), Keys(KeyV1)).GetStatusAsync(studio.Owner, studio.Person, CancellationToken.None))
            .Status.Should().Be(HealthStatus.Expired);
    }

    [Fact]
    public async Task SigningAgain_ReplacesTheCurrentDeclaration()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var health = Service(db);
        await health.SignMineAsync(studio.Member, Declaration(yesOn: "q1"), CancellationToken.None);

        var second = await health.SignMineAsync(studio.Member, Declaration(), CancellationToken.None);

        second.Declaration.Status.Should().Be(HealthStatus.SignedStatus);
        (await db.AsMasterAsync("SELECT count(*)::int FROM people.health_declarations WHERE superseded_at IS NOT NULL")).Should().Be(1);
        (await db.AsMasterAsync("SELECT count(*)::int FROM people.health_declarations WHERE superseded_at IS NULL")).Should().Be(1);
    }

    [Fact]
    public async Task IncompleteAnswersAStaleFormOrNoConfirmation_AreRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var health = Service(db);
        var full = Declaration();

        async Task<string> CodeOf(NewHealthDeclaration declaration) =>
            (await health.Invoking(h => h.SignMineAsync(studio.Member, declaration, CancellationToken.None)).Should().ThrowAsync<DomainRuleViolationException>()).Which.Code;

        (await CodeOf(full with { Answers = full.Answers.Skip(1).ToList() })).Should().Be("health.answers_incomplete");
        (await CodeOf(full with { Answers = [.. full.Answers, new HealthAnswerView("q99", false)] })).Should().Be("health.answers_incomplete");
        (await CodeOf(full with { FormVersion = 2 })).Should().Be("health.form_version_stale");
        (await CodeOf(full with { Confirmed = false })).Should().Be("health.confirmation_required");
        (await CodeOf(full with { SignerRole = "guardian", GuardianName = " " })).Should().Be("health.guardian_name_required");
        (await db.AsMasterAsync("SELECT count(*)::int FROM people.health_declarations")).Should().Be(0);
    }

    [Fact]
    public async Task TheGate_RefusesAMembersOwnBooking_UntilSigned_AndStaffBookingIsAudited()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var bookings = new BookingService(db, TimeProvider.System);
        var settings = new StudioSettingsService(db);
        var first = await SessionAsync(db, studio);
        var second = await SessionAsync(db, studio);

        // Off by default: the member books without a declaration.
        (await settings.GetPolicyAsync(studio.Owner, CancellationToken.None)).RequireHealthDeclaration.Should().BeFalse();
        (await bookings.BookAsync(studio.Member, first, null, CancellationToken.None)).Status.Should().Be("booked");

        var policy = await settings.GetPolicyAsync(studio.Owner, CancellationToken.None);
        (await settings.UpdatePolicyAsync(studio.Owner, policy with { RequireHealthDeclaration = true }, null, CancellationToken.None)).RequireHealthDeclaration.Should().BeTrue();

        var refused = () => bookings.BookAsync(studio.Member, second, null, CancellationToken.None);
        (await refused.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("health.declaration_required");

        // Staff may book on the member's behalf; it is on record.
        var byStaff = await bookings.BookAsync(studio.Owner, second, studio.Person, CancellationToken.None);
        byStaff.Status.Should().Be("booked");
        (await db.AsMasterAsync("SELECT count(*)::int FROM audit.audit_events WHERE action = 'booking.health_gate_bypassed'")).Should().Be(1);
        await bookings.CancelAsync(studio.Owner, byStaff.Id, false, CancellationToken.None);

        // A yes without approval is not enough; a clean signature is.
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q4"), CancellationToken.None);
        (await refused.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("health.declaration_required");
        await Service(db).SignMineAsync(studio.Member, Declaration(), CancellationToken.None);
        var third = await SessionAsync(db, studio);
        (await bookings.BookAsync(studio.Member, third, null, CancellationToken.None)).Status.Should().Be("booked");

        // Leaving the flag out of an update keeps it on.
        (await settings.UpdatePolicyAsync(studio.Owner, policy with { RequireHealthDeclaration = null }, null, CancellationToken.None)).RequireHealthDeclaration.Should().BeTrue();
    }

    [Fact]
    public async Task TheRoster_ShowsTheStatus_OnlyWithPeopleView()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var bookings = new BookingService(db, TimeProvider.System);
        var session = await SessionAsync(db, studio);
        await bookings.BookAsync(studio.Owner, session, studio.Person, CancellationToken.None);

        (await bookings.RosterAsync(studio.Owner, session, CancellationToken.None)).Booked.Single().HealthStatus.Should().Be(HealthStatus.Missing);
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q1"), CancellationToken.None);
        (await bookings.RosterAsync(studio.Owner, session, CancellationToken.None)).Booked.Single().HealthStatus.Should().Be(HealthStatus.NeedsMedicalApproval);

        var bookingsOnly = studio.Owner with { Permissions = new HashSet<string> { Permissions.BookingsManage } };
        (await bookings.RosterAsync(bookingsOnly, session, CancellationToken.None)).Booked.Single().HealthStatus.Should().BeNull();
    }

    [Fact]
    public async Task Export_DecryptsOnlyForHealthView_AndAuditsEachRead()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q5"), CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System, Keys(KeyV1));

        var byOwner = await lifecycle.ExportAsync(studio.Owner, studio.Person, CancellationToken.None);
        byOwner.HealthAnswersWithheld.Should().BeFalse();
        byOwner.HealthAnswersWithheldReason.Should().BeNull();
        byOwner.HealthDeclarations.Single().SignedName.Should().Be(MemberName);
        byOwner.HealthDeclarations.Single().Answers!.Single(a => a.QuestionId == "q5").Answer.Should().BeTrue();
        (await db.AsMasterAsync("SELECT count(*)::int FROM audit.audit_events WHERE action = 'health.declaration.viewed' AND data->>'purpose' = 'export'")).Should().Be(1);

        var admin = studio.Owner with { Permissions = SystemRoles.Admin.Permissions };
        var byAdmin = await lifecycle.ExportAsync(admin, studio.Person, CancellationToken.None);
        byAdmin.HealthAnswersWithheld.Should().BeTrue();
        byAdmin.HealthAnswersWithheldReason.Should().Be("no_health_view");
        byAdmin.HealthDeclarations.Single().Status.Should().Be(HealthStatus.NeedsMedicalApproval);
        byAdmin.HealthDeclarations.Single().Answers.Should().BeNull();
        byAdmin.HealthDeclarations.Single().SignedName.Should().BeNull();
    }

    [Fact]
    public async Task Export_WithAnUnreadableKey_StillSucceeds_WithEveryAnswerWithheld()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q2"), CancellationToken.None);

        // No HEALTH_DATA_KEY_V1 and no SSM prefix: the key cannot be read, as when SSM is down (A-5).
        var export = await new PersonLifecycleService(db, TimeProvider.System, new HealthDataKeys(_ => null)).ExportAsync(studio.Owner, studio.Person, CancellationToken.None);

        export.HealthAnswersWithheld.Should().BeTrue();
        export.HealthAnswersWithheldReason.Should().Be("health_key_unavailable");
        export.HealthDeclarations.Single().Status.Should().Be(HealthStatus.NeedsMedicalApproval);
        export.HealthDeclarations.Single().Answers.Should().BeNull();
        export.HealthDeclarations.Single().SignedName.Should().BeNull();
        export.Person.Person.Id.Should().Be(studio.Person);
        (await db.AsMasterAsync("SELECT count(*)::int FROM audit.audit_events WHERE action = 'health.declaration.viewed'")).Should().Be(0);
        (await db.AsMasterAsync("SELECT count(*)::int FROM audit.audit_events WHERE action = 'person.exported'")).Should().Be(1);
    }

    [Fact]
    public async Task Erase_DeletesEveryDeclaration()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q1"), CancellationToken.None);
        await Service(db).SignMineAsync(studio.Member, Declaration(), CancellationToken.None);

        await new PersonLifecycleService(db, TimeProvider.System, Keys(KeyV1)).EraseAsync(studio.Owner, studio.Person, "בקשת מחיקה", CancellationToken.None);

        (await db.AsMasterAsync("SELECT count(*)::int FROM people.health_declarations")).Should().Be(0);
        (await db.AsMasterAsync("SELECT data->>'healthDeclarations' FROM audit.audit_events WHERE action = 'person.erased'")).Should().Be("2");
        (await Service(db).GetStatusAsync(studio.Owner, studio.Person, CancellationToken.None)).Status.Should().Be(HealthStatus.Missing);
    }

    [Fact]
    public async Task Retention_DeletesAReplacedDeclaration_After90Days_AndKeepsTheCurrent()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q1"), CancellationToken.None);
        await Service(db).SignMineAsync(studio.Member, Declaration(), CancellationToken.None);
        var job = new RetentionJob(db, TimeProvider.System, RetentionPolicy.Default);

        (await job.RunAsync(CancellationToken.None)).HealthDeclarations.Should().Be(0, "the replaced one is not 90 days old yet");
        await db.AsMasterAsync("UPDATE people.health_declarations SET superseded_at = now() - interval '91 days' WHERE superseded_at IS NOT NULL");
        (await job.RunAsync(CancellationToken.None)).HealthDeclarations.Should().Be(1);

        (await db.AsMasterAsync("SELECT count(*)::int FROM people.health_declarations WHERE superseded_at IS NULL")).Should().Be(1);
    }

    [Fact]
    public async Task AMerge_MovesTheDeclarationToTheSurvivor_AndItStillOpens()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(yesOn: "q6"), CancellationToken.None);

        // A second record with the member's email is flagged as a duplicate; keep it, merge the signed one into it.
        var keep = (await new PeopleService(db).CreateAsync(studio.Owner, new NewPerson("לקוחה ב", null, null, null, "member-main@example.com", null), CancellationToken.None)).Person.Id;
        var pair = (Guid)(await db.AsMasterAsync("SELECT id FROM people.duplicate_candidates WHERE organization_id = $1", studio.Owner.OrganizationId))!;
        await new PersonLifecycleService(db, TimeProvider.System, Keys(KeyV1)).ResolveAsync(studio.Owner, pair, "merge", keep, CancellationToken.None);

        var answers = await Service(db).GetAnswersAsync(studio.Owner, keep, CancellationToken.None);
        answers.SignedName.Should().Be(MemberName);
        answers.Status.Should().Be(HealthStatus.NeedsMedicalApproval);
        (await db.AsMasterAsync("SELECT count(*)::int FROM people.health_declarations WHERE person_id = $1", studio.Person)).Should().Be(0);
    }

    [Fact]
    public async Task AnotherStudio_SeesNoDeclaration()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        await Service(db).SignMineAsync(studio.Member, Declaration(), CancellationToken.None);
        var other = await StudioAsync(db, "other");

        var read = () => Service(db).GetStatusAsync(other.Owner, studio.Person, CancellationToken.None);

        (await read.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.not_found");
    }

    private static HealthDeclarationService Service(MigratedDatabase db) => new(db, TimeProvider.System, Keys(KeyV1));

    private static HealthDataKeys Keys(string keyV1) => new(name => name == "HEALTH_DATA_KEY_V1" ? keyV1 : null);

    /// <summary>Every question answered "no", except <paramref name="yesOn"/>.</summary>
    private static NewHealthDeclaration Declaration(string? yesOn = null, bool guardian = false) =>
        new(
            HealthForms.Current.Version,
            [.. HealthForms.Current.Questions.Select(q => new HealthAnswerView(q.Id, q.Id == yesOn))],
            MemberName,
            guardian ? "guardian" : "self",
            guardian ? GuardianName : null,
            true);

    /// <summary>Every byte of the declaration rows, as UTF-8 text and as hex, to search for plaintext.</summary>
    /// <summary>The row as Postgres prints it (bytea as hex), and the ciphertext columns' bytes read as UTF-8.</summary>
    private static async Task<(string Text, string Decoded)> RawRowAsync(MigratedDatabase db)
    {
        var text = (string)(await db.AsMasterAsync("SELECT string_agg(d::text, ' ') FROM people.health_declarations d"))!;
        var bytes = (byte[])(await db.AsMasterAsync("SELECT answers_ciphertext || signed_name_ciphertext || coalesce(guardian_name_ciphertext, ''::bytea) FROM people.health_declarations"))!;
        return (text, Encoding.UTF8.GetString(bytes));
    }

    private sealed record Studio(TenantContext Owner, TenantContext Member, Guid Person, Guid ClassType);

    private static async Task<Studio> StudioAsync(MigratedDatabase db, string slug = "main")
    {
        var ownerAccount = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            ownerAccount, $"owner-{slug}@example.com");
        var created = await new OrganizationService(db).CreateAsync(new AccountSnapshot(ownerAccount, AccountStatus.Active, true), new NewOrganization("Main", $"studio-{slug}", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(ownerAccount, created.Id, CancellationToken.None))!;
        var owner = new TenantContext(created.Id, ownerAccount, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");

        var account = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account, $"member-{slug}@example.com");
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', 'active', now(), now())",
            created.Id, membershipId, account);
        var person = (await new PeopleService(db).CreateAsync(owner, new NewPerson("לקוחה", null, null, null, $"member-{slug}@example.com", null), CancellationToken.None)).Person.Id;
        await db.AsMasterAsync("UPDATE people.people SET user_account_id = $1, membership_id = $2 WHERE id = $3", account, membershipId, person);
        var passes = new PassService(db, TimeProvider.System);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, null), CancellationToken.None);
        await passes.GrantAsync(owner, person, new NewPass(card.Id, null, null), CancellationToken.None);
        var classType = await new TimetableService(db, TimeProvider.System).CreateClassTypeAsync(owner, new NewClassType("פילאטיס", "pilates", "rose", 50, null), CancellationToken.None);
        return new Studio(owner, new TenantContext(created.Id, account, membershipId, MembershipRole.Client, OrganizationStatus.Active, "test"), person, classType.Id);
    }

    private static async Task<Guid> SessionAsync(MigratedDatabase db, Studio studio)
    {
        var id = Guid.CreateVersion7();
        var startsAt = DateTimeOffset.UtcNow.AddDays(1).AddMinutes(Random.Shared.Next(0, 600));
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 8, 'scheduled', now(), now())",
            studio.Owner.OrganizationId, id, DateOnly.FromDateTime(startsAt.UtcDateTime), studio.ClassType, startsAt, startsAt.AddMinutes(50));
        return id;
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
