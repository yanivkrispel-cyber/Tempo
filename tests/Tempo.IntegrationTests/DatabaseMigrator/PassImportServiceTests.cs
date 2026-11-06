using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Pass import from a file (docs/40, board #584 K3) on PostgreSQL 18 as `tempo_app`: the dry run, every outcome, a
/// card's entries left, a second run that adds nothing, RLS between studios, the permission check and the audit.
/// Every name, email and phone is fictional.
/// </summary>
public sealed class PassImportServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    // 10:00 UTC is 12:00 in Jerusalem: the studio's today is 2026-11-03.
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 11, 3, 10, 0, 0, TimeSpan.Zero));
    private static readonly DateOnly Today = new(2026, 11, 3);

    [Fact]
    public async Task ADryRun_ChecksEveryRow_AndWritesNothing()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var result = await Import(db).ImportAsync(studio.Owner, dryRun: true, FiveRows(), CancellationToken.None);

        result.DryRun.Should().BeTrue();
        result.ImportId.Should().BeNull();
        result.Rows.Select(r => r.Outcome).Should().Equal("valid", "valid", "duplicate_in_file", "invalid", "invalid");
        result.Totals.Should().Be(new ImportTotals(Rows: 5, Valid: 2, Created: 0, Exists: 0, DuplicateInFile: 1, Invalid: 2));
        result.Rows[0].PersonId.Should().Be(studio.Noa);
        result.Rows[0].PassId.Should().BeNull();
        result.Rows[2].DuplicateOfLine.Should().Be(2);
        result.Rows[3].Should().Match<PassImportRowOutcome>(r => r.Field == "person" && r.Code == "person.not_found");
        result.Rows[4].Should().Match<PassImportRowOutcome>(r => r.Field == "product" && r.Code == "product.not_found");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes")).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action IN ('pass.granted', 'passes.imported')")).Should().Be(0L);
    }

    [Fact]
    public async Task AnImport_CreatesThePasses_WithSourceImport_TheEntriesLeftAndTheDates()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var result = await Import(db).ImportAsync(studio.Owner, dryRun: false, FiveRows(), CancellationToken.None);

        result.ImportId.Should().NotBeNull();
        result.Totals.Should().Be(new ImportTotals(5, 2, 2, 0, 1, 2));
        result.Rows.Where(r => r.Outcome == "created").Should().HaveCount(2).And.OnlyContain(r => r.PassId != null);

        var passes = new PassService(db, Clock);
        var card = (await passes.ListForPersonAsync(studio.Owner, studio.Noa, CancellationToken.None)).Single();
        card.Source.Should().Be("import");
        card.Product.Id.Should().Be(studio.Card);
        card.Entries.Should().Be(10, "a card keeps its product's size");
        card.EntriesLeft.Should().Be(6);
        card.StartsOn.Should().Be(Today, "an empty valid-from is the studio's today");
        card.EndsOn.Should().Be(new DateOnly(2027, 3, 31));
        card.Status.Should().Be("active");

        var membership = (await passes.ListForPersonAsync(studio.Owner, studio.Dana, CancellationToken.None)).Single();
        membership.Source.Should().Be("import");
        membership.Entries.Should().BeNull();
        membership.StartsOn.Should().Be(new DateOnly(2026, 10, 1));
        membership.EndsOn.Should().Be(new DateOnly(2026, 12, 31));

        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'pass.granted' AND data->>'source' = 'import'")).Should().Be(2L);
        var summary = (string)(await db.AsMasterAsync("SELECT data::text FROM audit.audit_events WHERE action = 'passes.imported'"))!;
        summary.Should().Contain("\"created\": 2").And.Contain("\"invalid\": 2");
        var allAudit = (string)(await db.AsMasterAsync("SELECT string_agg(data::text, ' ') FROM audit.audit_events WHERE action IN ('pass.granted', 'passes.imported')"))!;
        allAudit.Should().NotContain("@example.com").And.NotContain("97250", "the audit keeps no emails or phones");
    }

    [Fact]
    public async Task APassGrantedAtTheDesk_IsSourceDesk()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var granted = await new PassService(db, Clock).GrantAsync(studio.Owner, studio.Noa, new NewPass(studio.Card, null, null), CancellationToken.None);

        granted.Source.Should().Be("desk");
    }

    [Fact]
    public async Task TheSameRowsTwice_CreateNothingTheSecondTime()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var first = await Import(db).ImportAsync(studio.Owner, dryRun: false, FiveRows(), CancellationToken.None);
        var check = await Import(db).ImportAsync(studio.Owner, dryRun: true, FiveRows(), CancellationToken.None);
        var second = await Import(db).ImportAsync(studio.Owner, dryRun: false, FiveRows(), CancellationToken.None);

        first.Totals.Created.Should().Be(2);
        check.Totals.Should().Be(new ImportTotals(5, 0, 0, 2, 1, 2));
        second.Totals.Should().Be(new ImportTotals(5, 0, 0, 2, 1, 2));
        second.ImportId.Should().BeNull("nothing was created");
        second.Rows[0].PassId.Should().Be(first.Rows[0].PassId);
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes WHERE source = 'import'")).Should().Be(2L);
    }

    [Fact]
    public async Task APassAlreadyGrantedAtTheDesk_DoesNotStopTheImport()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");
        await new PassService(db, Clock).GrantAsync(studio.Owner, studio.Noa, new NewPass(studio.Card, null, null), CancellationToken.None);

        var result = await Import(db).ImportAsync(studio.Owner, dryRun: false, [Row(2, email: "noa@example.com", product: "כרטיסיית 10", left: "6", until: "31/03/2027")], CancellationToken.None);

        result.Rows[0].Outcome.Should().Be("created", "only an imported pass counts as already there (PI-8)");
    }

    [Fact]
    public async Task AnotherStudiosPersonAndProduct_AreNeverFound()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studioA = await StudioAsync(db, "studio-a");
        var studioB = await StudioAsync(db, "studio-b", people: false);
        await new PeopleService(db).CreateAsync(studioB.Owner, new NewPerson("Only In B", null, null, null, "only-b@example.com", "050-2345688"), CancellationToken.None);
        await new PassService(db, Clock).CreateProductAsync(studioB.Owner, new NewPassProduct("punch_card", "Only B card", 5, 60, null, null, null), CancellationToken.None);

        PassImportRowInput[] rows =
        [
            Row(2, email: "only-b@example.com", product: "כרטיסיית 10", left: "3", until: "31/12/2026"),
            Row(3, phone: "050-2345688", product: "כרטיסיית 10", left: "3", until: "31/12/2026"),
            Row(4, email: "noa@example.com", product: "Only B card", left: "3", until: "31/12/2026"),
        ];
        var result = await Import(db).ImportAsync(studioA.Owner, dryRun: false, rows, CancellationToken.None);

        result.Rows[0].Should().Match<PassImportRowOutcome>(r => r.Code == "person.not_found");
        result.Rows[1].Should().Match<PassImportRowOutcome>(r => r.Code == "person.not_found");
        result.Rows[2].Should().Match<PassImportRowOutcome>(r => r.Code == "product.not_found");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes")).Should().Be(0L);
    }

    [Fact]
    public async Task AContactOnTwoActivePeople_IsAmbiguous_NotAGuess()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");
        await new PeopleService(db).CreateAsync(studio.Owner, new NewPerson("נועה לוי השנייה", null, null, null, "noa@example.com", null), CancellationToken.None);

        var result = await Import(db).ImportAsync(studio.Owner, dryRun: true, [Row(2, email: "noa@example.com", product: "כרטיסיית 10", left: "6", until: "31/03/2027")], CancellationToken.None);

        result.Rows[0].Should().Match<PassImportRowOutcome>(r => r.Outcome == "invalid" && r.Field == "person" && r.Code == "person.ambiguous");
    }

    [Theory]
    [InlineData(null, null, "כרטיסיית 10", "6", "31/03/2027", null, "contact", "contact.required")]
    [InlineData("not-an-email", null, "כרטיסיית 10", "6", "31/03/2027", null, "email", "email.invalid")]
    [InlineData(null, "12", "כרטיסיית 10", "6", "31/03/2027", null, "phone", "phone.invalid")]
    [InlineData("noa@example.com", "050-2345672", "כרטיסיית 10", "6", "31/03/2027", null, "person", "person.ambiguous")]
    [InlineData("gone@example.com", null, "כרטיסיית 10", "6", "31/03/2027", null, "person", "person.read_only")]
    [InlineData("noa@example.com", null, null, "6", "31/03/2027", null, "product", "required")]
    [InlineData("noa@example.com", null, "Old card", "6", "31/03/2027", null, "product", "product.not_found")]
    [InlineData("noa@example.com", null, "Twice", "6", "31/03/2027", null, "product", "product.ambiguous")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", null, "31/03/2027", null, "entries_left", "required")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "six", "31/03/2027", null, "entries_left", "entries_left.invalid")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "0", "31/03/2027", null, "entries_left", "entries_left.invalid")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "11", "31/03/2027", null, "entries_left", "entries_left.too_many")]
    [InlineData("noa@example.com", null, "Monthly", "3", "31/03/2027", null, "entries_left", "entries_left.not_allowed")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "6", null, null, "valid_until", "required")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "6", "31/02/2027", null, "valid_until", "date.invalid")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "6", "02/11/2026", null, "valid_until", "valid_until.past")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "6", "03/11/2028", null, "valid_until", "valid_until.too_far")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "6", "31/03/2027", "2027/01/01", "valid_from", "date.invalid")]
    [InlineData("noa@example.com", null, "כרטיסיית 10", "6", "31/03/2027", "01.04.2027", "valid_from", "valid_from.after_until")]
    public async Task AnInvalidRow_SaysWhichFieldAndWhy(string? email, string? phone, string? product, string? left, string? until, string? from, string field, string code)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");
        var passes = new PassService(db, Clock);
        var old = await passes.CreateProductAsync(studio.Owner, new NewPassProduct("punch_card", "Old card", 5, 30, null, null, null), CancellationToken.None);
        await passes.ArchiveProductAsync(studio.Owner, old.Id, CancellationToken.None);
        await passes.CreateProductAsync(studio.Owner, new NewPassProduct("punch_card", "Twice", 5, 30, null, null, null), CancellationToken.None);
        await passes.CreateProductAsync(studio.Owner, new NewPassProduct("punch_card", " twice ", 8, 30, null, null, null), CancellationToken.None);
        var gone = await new PeopleService(db).CreateAsync(studio.Owner, new NewPerson("Gone", null, null, null, "gone@example.com", null), CancellationToken.None);
        await db.AsMasterAsync("UPDATE people.people SET status = 'archived' WHERE id = $1", gone.Person.Id);

        var result = await Import(db).ImportAsync(studio.Owner, dryRun: true, [new(2, email, phone, product, left, from, until)], CancellationToken.None);

        result.Rows[0].Should().Match<PassImportRowOutcome>(r => r.Outcome == "invalid" && r.Field == field && r.Code == code);
    }

    [Fact]
    public async Task TheLastDayInTwoYears_AndAMembershipFromThePast_AreFine()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        PassImportRowInput[] rows =
        [
            Row(2, email: "noa@example.com", product: " כרטיסיית 10 ", left: "10", until: "02/11/2028"),
            Row(3, phone: "+972502345672", product: "monthly", until: "2026-11-03", from: "1.9.2026"),
        ];
        var result = await Import(db).ImportAsync(studio.Owner, dryRun: true, rows, CancellationToken.None);

        result.Rows.Select(r => r.Outcome).Should().Equal("valid", "valid");
    }

    [Fact]
    public async Task ACallerWithoutPassesManage_IsRefused_BeforeAnyRowIsRead()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");
        var importOnly = studio.Owner with { Permissions = new HashSet<string> { Permissions.PeopleImport } };

        var act = () => Import(db).ImportAsync(importOnly, dryRun: true, FiveRows(), CancellationToken.None);

        (await act.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
    }

    [Fact]
    public async Task NoRowsOrMoreThanAThousand_IsRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");
        var tooMany = Enumerable.Range(2, 1001).Select(line => Row(line, email: "noa@example.com", product: "כרטיסיית 10", left: "1", until: "31/12/2026")).ToArray();

        var empty = () => Import(db).ImportAsync(studio.Owner, dryRun: true, [], CancellationToken.None);
        var big = () => Import(db).ImportAsync(studio.Owner, dryRun: true, tooMany, CancellationToken.None);

        (await empty.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("import.too_many_rows");
        (await big.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("import.too_many_rows");
    }

    /// <summary>A card for Noa, a membership for Dana, a repeat of Noa's card, a stranger, and a product the studio lacks.</summary>
    private static PassImportRowInput[] FiveRows() =>
    [
        Row(2, email: "noa@example.com", product: "כרטיסיית 10", left: "6", until: "31/03/2027"),
        Row(3, phone: "050-2345672", product: "Monthly", from: "01/10/2026", until: "31/12/2026"),
        Row(4, phone: "+972502345671", product: "כרטיסיית 10", left: "2", until: "31/01/2027"),
        Row(5, email: "stranger@example.com", product: "כרטיסיית 10", left: "6", until: "31/03/2027"),
        Row(6, email: "dana@example.com", product: "Yoga 20", left: "6", until: "31/03/2027"),
    ];

    private static PassImportRowInput Row(int line, string? email = null, string? phone = null, string? product = null, string? left = null, string? until = null, string? from = null) =>
        new(line, email, phone, product, left, from, until);

    private static PassImportService Import(MigratedDatabase db) => new(db, Clock);

    private sealed record Studio(TenantContext Owner, Guid Noa, Guid Dana, Guid Card, Guid Monthly);

    /// <summary>A studio with two people (Noa by email and phone, Dana by phone and email), a card of 10 and a membership.</summary>
    private static async Task<Studio> StudioAsync(MigratedDatabase db, string slug, bool people = true)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id,
            $"owner-{slug}@example.com");
        var account = new AccountSnapshot(id, AccountStatus.Active, true);
        var organization = await new OrganizationService(db).CreateAsync(account, new NewOrganization("Main", slug, null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(id, organization.Id, CancellationToken.None))!;
        var owner = new TenantContext(organization.Id, id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");

        var passes = new PassService(db, Clock);
        var card = await passes.CreateProductAsync(owner, new NewPassProduct("punch_card", "כרטיסיית 10", 10, 90, null, null, null), CancellationToken.None);
        var monthly = await passes.CreateProductAsync(owner, new NewPassProduct("membership", "Monthly", null, 30, null, null, null), CancellationToken.None);
        if (!people)
        {
            return new Studio(owner, Guid.Empty, Guid.Empty, card.Id, monthly.Id);
        }

        var directory = new PeopleService(db);
        var noa = await directory.CreateAsync(owner, new NewPerson("נועה לוי", null, null, null, "noa@example.com", "050-2345671"), CancellationToken.None);
        var dana = await directory.CreateAsync(owner, new NewPerson("דנה כהן", null, null, null, "dana@example.com", "050-2345672"), CancellationToken.None);
        return new Studio(owner, noa.Person.Id, dana.Person.Id, card.Id, monthly.Id);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
