using System.Diagnostics;
using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Xunit;
using Xunit.Abstractions;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Member import from a file (docs/34 sections 4 to 6) on PostgreSQL 18 as `tempo_app`: the dry run, every outcome,
/// duplicates by contact and by name and birth date, RLS between studios, the audit, a repeated import, and the time
/// for 1,000 rows. Every name, email and phone is fictional.
/// </summary>
public sealed class PeopleImportServiceTests(PostgresFixture postgres, ITestOutputHelper output) : IClassFixture<PostgresFixture>
{
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 10, 17, 16, 0, 0, TimeSpan.Zero));

    [Fact]
    public async Task ADryRun_ChecksEveryRow_AndWritesNothing()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var before = await CountAsync(db, "people.people");

        var result = await Import(db).ImportAsync(owner, dryRun: true, SixRows(), CancellationToken.None);

        result.DryRun.Should().BeTrue();
        result.ImportId.Should().BeNull();
        result.Rows.Select(r => r.Outcome).Should().Equal("valid", "valid", "duplicate_in_file", "invalid", "valid", "invalid");
        result.Totals.Should().Be(new ImportTotals(Rows: 6, Valid: 3, Created: 0, Exists: 0, DuplicateInFile: 1, Invalid: 2));
        result.Rows.Where(r => r.Outcome == "valid").Should().OnlyContain(r => r.PersonId == null);
        (await CountAsync(db, "people.people")).Should().Be(before);
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action IN ('person.created', 'people.imported')")).Should().Be(0L);
    }

    [Fact]
    public async Task ACommit_CreatesTheGoodRows_WithSourceImport_AndAudits()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");

        var result = await Import(db).ImportAsync(owner, dryRun: false, SixRows(), CancellationToken.None);

        result.ImportId.Should().NotBeNull();
        result.Totals.Should().Be(new ImportTotals(6, 3, 3, 0, 1, 2));
        var created = result.Rows.Where(r => r.Outcome == "created").ToList();
        created.Should().HaveCount(3).And.OnlyContain(r => r.PersonId != null);
        result.Rows[2].DuplicateOfLine.Should().Be(2);
        result.Rows[3].Should().Match<ImportRowOutcome>(r => r.Field == "phone" && r.Code == "phone.invalid");
        result.Rows[5].Should().Match<ImportRowOutcome>(r => r.Field == "contact" && r.Code == "contact.required");

        var noa = await new PeopleService(db).GetAsync(owner, created[0].PersonId!.Value, CancellationToken.None);
        noa.Person.Source.Should().Be("import");
        noa.Person.DisplayName.Should().Be("נועה לוי");
        noa.Person.BirthDate.Should().Be(new DateOnly(1990, 5, 1));
        noa.Person.PrimaryPhone.Should().Be("+972502345671");
        noa.Person.PrimaryEmail.Should().Be("noa@example.com");
        noa.Consents.Should().BeEmpty("an import records no consent (I-6)");

        var dana = await new PeopleService(db).GetAsync(owner, created[1].PersonId!.Value, CancellationToken.None);
        dana.Person.DisplayName.Should().Be("דנה כהן", "given and family names are joined when there is no display name");

        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'person.created' AND data->>'source' = 'import'")).Should().Be(3L);
        var summary = (string)(await db.AsMasterAsync("SELECT data::text FROM audit.audit_events WHERE action = 'people.imported'"))!;
        summary.Should().Contain("\"created\": 3").And.Contain("\"invalid\": 2");
        var allAudit = (string)(await db.AsMasterAsync("SELECT string_agg(data::text, ' ') FROM audit.audit_events"))!;
        allAudit.Should().NotContain("נועה").And.NotContain("noa@").And.NotContain("97250", "the audit keeps no names, emails or phones");
    }

    [Fact]
    public async Task APersonAlreadyInTheStudio_IsExists_AndNothingChanges()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var known = await new PeopleService(db).CreateAsync(owner, new NewPerson("רוני", null, null, null, null, "050-2345699"), CancellationToken.None);

        // The same number written the other way, and an email that someone else in the file already used.
        ImportRowInput[] rows =
        [
            new(2, "רוני אחר", null, null, "+972502345699", null, null),
            new(3, "חדשה", null, null, null, "new@example.com", null),
        ];
        var result = await Import(db).ImportAsync(owner, dryRun: false, rows, CancellationToken.None);

        result.Rows[0].Should().Match<ImportRowOutcome>(r => r.Outcome == "exists" && r.PersonId == known.Person.Id);
        result.Rows[1].Outcome.Should().Be("created");
        var after = await new PeopleService(db).GetAsync(owner, known.Person.Id, CancellationToken.None);
        after.Person.DisplayName.Should().Be("רוני");
        after.Person.Version.Should().Be(known.Person.Version);
    }

    [Fact]
    public async Task TheSameRowsTwice_CreateNothingTheSecondTime()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");

        var first = await Import(db).ImportAsync(owner, dryRun: false, SixRows(), CancellationToken.None);
        var second = await Import(db).ImportAsync(owner, dryRun: false, SixRows(), CancellationToken.None);

        first.Totals.Created.Should().Be(3);
        second.Totals.Should().Be(new ImportTotals(6, 0, 0, 3, 1, 2));
        second.ImportId.Should().BeNull("nothing was created");
        (await db.AsMasterAsync("SELECT count(*) FROM people.people WHERE source = 'import'")).Should().Be(3L);
    }

    [Fact]
    public async Task ANameAndBirthDateMatch_IsCreated_AndFlaggedAsAPossibleDuplicate()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var known = await new PeopleService(db).CreateAsync(owner, new NewPerson("Maya Bar", null, null, new DateOnly(1985, 3, 9), "maya@example.com", null), CancellationToken.None);

        ImportRowInput[] rows = [new(2, "maya bar", null, null, null, "maya.bar@example.com", "09/03/1985")];
        var check = await Import(db).ImportAsync(owner, dryRun: true, rows, CancellationToken.None);
        var result = await Import(db).ImportAsync(owner, dryRun: false, rows, CancellationToken.None);

        check.Rows[0].PossibleDuplicate.Should().BeTrue();
        result.Rows[0].Should().Match<ImportRowOutcome>(r => r.Outcome == "created" && r.PossibleDuplicate);
        (await db.AsMasterAsync(
            "SELECT count(*) FROM people.duplicate_candidates WHERE reason = 'name_birth_date' AND status = 'open' AND $1 IN (person_a_id, person_b_id)",
            known.Person.Id)).Should().Be(1L);
    }

    [Theory]
    [InlineData(null, null, null, "050-2345671", null, "display_name", "required")]
    [InlineData("Noa", null, null, "12", null, "phone", "phone.invalid")]
    [InlineData("Noa", null, null, null, "not-an-email", "email", "email.invalid")]
    [InlineData("Noa", null, null, null, null, "contact", "contact.required")]
    [InlineData("Noa", null, null, "050-2345671", "31/02/1990", "birth_date", "birth_date.invalid")]
    [InlineData("Noa", null, null, "050-2345671", "18/10/2026", "birth_date", "birth_date.invalid")]
    [InlineData("Noa", null, null, "050-2345671", "1990/05/01", "birth_date", "birth_date.invalid")]
    public async Task AnInvalidRow_SaysWhichFieldAndWhy(string? name, string? given, string? family, string? phone, string? emailOrDate, string field, string code)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var isDate = emailOrDate?.Contains('/') == true;
        ImportRowInput[] rows = [new(7, name, given, family, phone, isDate ? null : emailOrDate, isDate ? emailOrDate : null)];

        var result = await Import(db).ImportAsync(owner, dryRun: true, rows, CancellationToken.None);

        result.Rows[0].Should().Match<ImportRowOutcome>(r => r.Line == 7 && r.Outcome == "invalid" && r.Field == field && r.Code == code);
    }

    [Theory]
    [InlineData("1/5/1990")]
    [InlineData("01/05/1990")]
    [InlineData("1.5.1990")]
    [InlineData("1990-05-01")]
    public async Task BirthDates_ReadInEachAgreedForm(string typed)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");

        var result = await Import(db).ImportAsync(owner, dryRun: false, [new(2, "Noa", null, null, "050-2345671", null, typed)], CancellationToken.None);

        var person = await new PeopleService(db).GetAsync(owner, result.Rows[0].PersonId!.Value, CancellationToken.None);
        person.Person.BirthDate.Should().Be(new DateOnly(1990, 5, 1));
    }

    [Fact]
    public async Task NoRows_OrMoreThanAThousand_Is400()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var tooMany = Enumerable.Range(2, 1001).Select(i => new ImportRowInput(i, $"Person {i}", null, null, null, $"p{i}@example.com", null)).ToList();

        var empty = () => Import(db).ImportAsync(owner, dryRun: true, [], CancellationToken.None);
        var big = () => Import(db).ImportAsync(owner, dryRun: true, tooMany, CancellationToken.None);

        (await empty.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("import.too_many_rows");
        (await big.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("import.too_many_rows");
    }

    [Fact]
    public async Task APersonInAnotherStudio_NeverCountsAsExists()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studioA = await StudioAsync(db, "studio-a");
        var studioB = await StudioAsync(db, "studio-b");
        await new PeopleService(db).CreateAsync(studioB, new NewPerson("Noa B", null, null, null, "noa@example.com", "050-2345671"), CancellationToken.None);

        var result = await Import(db).ImportAsync(studioA, dryRun: false, [new(2, "Noa A", null, null, "050-2345671", "noa@example.com", null)], CancellationToken.None);

        result.Rows[0].Outcome.Should().Be("created");
        (await db.AsMasterAsync("SELECT count(*) FROM people.people WHERE organization_id = $1", studioB.OrganizationId)).Should().Be(2L, "studio B keeps its owner and its own Noa");
    }

    [Fact]
    public async Task AThousandRows_FinishWellInsideTheApiLimit()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var rows = Enumerable.Range(2, 1000)
            .Select(i => new ImportRowInput(i, $"מתאמן {i}", null, null, $"050-{2000000 + i}", $"member{i}@example.com", i % 3 == 0 ? "01/01/1990" : null))
            .ToList();

        var watch = Stopwatch.StartNew();
        var result = await Import(db).ImportAsync(owner, dryRun: false, rows, CancellationToken.None);
        watch.Stop();

        output.WriteLine($"1,000 rows imported in {watch.ElapsedMilliseconds} ms");
        result.Totals.Created.Should().Be(1000);
        watch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(10));
        (await db.AsMasterAsync("SELECT count(*) FROM people.contact_points WHERE organization_id = $1", owner.OrganizationId)).Should().Be(2001L, "two contacts each, and the owner's email");
    }

    [Fact]
    public async Task ABatchTag_GoesOnEveryCreatedPerson_AndNotOnOnesAlreadyThere()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var known = await new PeopleService(db).CreateAsync(owner, new NewPerson("רוני", null, null, null, null, "050-2345699"), CancellationToken.None);
        var batch = await new PeopleTagsAndNotesService(db).CreateTagAsync(owner, "ייבוא 17.10", 2, CancellationToken.None);
        ImportRowInput[] rows =
        [
            new(2, "רוני", null, null, "050-2345699", null, null),
            new(3, "חדשה", null, null, null, "new@example.com", null),
            new(4, "עוד אחת", null, null, null, "another@example.com", null),
        ];

        var result = await Import(db).ImportAsync(owner, dryRun: false, rows, CancellationToken.None, batch.Id);

        var tagged = (await new PeopleService(db).ListAsync(owner, new PeopleQuery(null, null, null, 50, batch.Id), CancellationToken.None)).Items;
        tagged.Select(p => p.Id).Should().BeEquivalentTo(result.Rows.Where(r => r.Outcome == "created").Select(r => r.PersonId!.Value));
        tagged.Should().NotContain(p => p.Id == known.Person.Id);
        ((string)(await db.AsMasterAsync("SELECT data::text FROM audit.audit_events WHERE action = 'people.imported'"))!).Should().Contain("\"tagged\": 2");
    }

    [Fact]
    public async Task ATagFromAnotherStudio_IsNotFound()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studioA = await StudioAsync(db, "studio-a");
        var studioB = await StudioAsync(db, "studio-b");
        var tagB = await new PeopleTagsAndNotesService(db).CreateTagAsync(studioB, "VIP", 1, CancellationToken.None);

        var import = () => Import(db).ImportAsync(studioA, dryRun: true, [new(2, "Noa", null, null, null, "noa@example.com", null)], CancellationToken.None, tagB.Id);

        (await import.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("tag.not_found");
    }

    /// <summary>Line 2 Noa, line 3 Dana by given and family names, line 4 repeats Noa's phone, line 5 a bad phone,
    /// line 6 Yossi, line 7 no contact.</summary>
    private static IReadOnlyList<ImportRowInput> SixRows() =>
    [
        new(2, " נועה לוי ", null, null, "050-2345671", "Noa@Example.com", "01/05/1990"),
        new(3, null, "דנה", "כהן", "052-3456789", null, null),
        new(4, "נועה שוב", null, null, "0502345671", null, null),
        new(5, "טל", null, null, "123", null, null),
        new(6, "יוסי", null, null, null, "yossi@example.com", "1980-12-31"),
        new(7, "בלי קשר", null, null, null, null, null),
    ];

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static PeopleImportService Import(MigratedDatabase db) => new(db, Clock);

    private static async Task<long> CountAsync(MigratedDatabase db, string table) =>
        (long)(await db.AsMasterAsync($"SELECT count(*) FROM {table}"))!;

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db, string slug)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id,
            $"owner-{slug}@example.com");
        var account = new AccountSnapshot(id, AccountStatus.Active, true);
        var studio = await new OrganizationService(db).CreateAsync(account, new NewOrganization("Main", slug, null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, studio.Id, CancellationToken.None))!;
        return new TenantContext(studio.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }
}
