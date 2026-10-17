using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.People.Application;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Tags and staff notes (docs/34 sections 7 to 9) on PostgreSQL 18 as `tempo_app`: the limits, who deletes which note,
/// erase, merge and export, the tag filter, the audit without text, and RLS between studios. Every name is fictional.
/// </summary>
public sealed class PeopleTagsAndNotesServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Tags_AreUniqueIgnoringCase_AndCheckTheirNameAndColour()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var service = new PeopleTagsAndNotesService(db);

        var morning = await service.CreateTagAsync(owner, "  בוקר ", 2, CancellationToken.None);
        var clash = () => service.CreateTagAsync(owner, "VIP", 1, CancellationToken.None);
        await clash();
        var sameName = () => service.CreateTagAsync(owner, "vip", 3, CancellationToken.None);
        var longName = () => service.CreateTagAsync(owner, new string('א', 31), 1, CancellationToken.None);
        var badColour = () => service.CreateTagAsync(owner, "ערב", 7, CancellationToken.None);

        morning.Should().Match<TagView>(t => t.Name == "בוקר" && t.Color == 2 && t.PeopleCount == 0);
        (await sameName.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("tag.name_taken");
        (await longName.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("tag.name_too_long");
        (await badColour.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("tag.color_invalid");

        var renamed = await service.UpdateTagAsync(owner, morning.Id, "Morning", null, morning.Version, CancellationToken.None);
        renamed.Should().Match<TagView>(t => t.Name == "Morning" && t.Color == 2 && t.Version == morning.Version + 1);
        var renameClash = () => service.UpdateTagAsync(owner, morning.Id, "VIP", null, null, CancellationToken.None);
        (await renameClash.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("tag.name_taken");
        (await service.ListTagsAsync(owner, CancellationToken.None)).Select(t => t.Name).Should().Equal("Morning", "VIP");
    }

    [Fact]
    public async Task AStudioHasAtMost100Tags_AndAPersonAtMost20()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var service = new PeopleTagsAndNotesService(db);
        var person = await PersonAsync(db, owner, "נועה");

        var tags = new List<TagView>();
        for (var i = 1; i <= 100; i++)
        {
            tags.Add(await service.CreateTagAsync(owner, $"tag {i}", 1, CancellationToken.None));
        }

        for (var i = 0; i < 20; i++)
        {
            await service.TagPersonAsync(owner, person, tags[i].Id, CancellationToken.None);
        }

        var tooManyTags = () => service.CreateTagAsync(owner, "tag 101", 1, CancellationToken.None);
        var tooManyOnPerson = () => service.TagPersonAsync(owner, person, tags[20].Id, CancellationToken.None);

        (await tooManyTags.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("tag.limit_reached");
        (await tooManyOnPerson.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.tag_limit_reached");
        (await service.TagPersonAsync(owner, person, tags[0].Id, CancellationToken.None)).Should().HaveCount(20, "tagging twice changes nothing");
    }

    [Fact]
    public async Task APersonsTags_ShowOnThePerson_AndFilterTheList_AndDeletingATagTakesItOffEveryone()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var service = new PeopleTagsAndNotesService(db);
        var people = new PeopleService(db);
        var noa = await PersonAsync(db, owner, "נועה");
        var dana = await PersonAsync(db, owner, "דנה");
        var vip = await service.CreateTagAsync(owner, "VIP", 3, CancellationToken.None);
        var morning = await service.CreateTagAsync(owner, "בוקר", 1, CancellationToken.None);
        await service.TagPersonAsync(owner, noa, vip.Id, CancellationToken.None);
        await service.TagPersonAsync(owner, noa, morning.Id, CancellationToken.None);
        await service.TagPersonAsync(owner, dana, morning.Id, CancellationToken.None);

        (await people.GetAsync(owner, noa, CancellationToken.None)).Person.Tags!.Select(t => t.Name).Should().Equal("VIP", "בוקר");
        (await people.ListAsync(owner, new PeopleQuery(null, null, null, 50, vip.Id), CancellationToken.None)).Items.Select(p => p.Id).Should().Equal(noa);
        (await people.ListAsync(owner, new PeopleQuery(null, null, null, 50, morning.Id), CancellationToken.None)).Items.Should().HaveCount(2);
        (await service.ListTagsAsync(owner, CancellationToken.None)).Single(t => t.Id == morning.Id).PeopleCount.Should().Be(2);

        await service.UntagPersonAsync(owner, noa, vip.Id, CancellationToken.None);
        await service.DeleteTagAsync(owner, morning.Id, CancellationToken.None);

        (await people.GetAsync(owner, noa, CancellationToken.None)).Person.Tags.Should().BeEmpty();
        (await db.AsMasterAsync("SELECT count(*) FROM people.person_tags")).Should().Be(0L);
        var audit = (string)(await db.AsMasterAsync("SELECT string_agg(action, ',' ORDER BY occurred_at) FROM audit.audit_events WHERE action LIKE 'tag.%' OR action LIKE 'person.%tagged'"))!;
        audit.Should().Contain("tag.created").And.Contain("person.tagged").And.Contain("person.untagged").And.Contain("tag.deleted");
    }

    [Fact]
    public async Task Notes_AreNewestFirst_AndOnlyTheAuthorOrAModeratorDeletesOne()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var staff = await MemberAsync(db, owner, "staff", MembershipRole.Staff);
        var otherStaff = await MemberAsync(db, owner, "staff2", MembershipRole.Staff);
        var service = new PeopleTagsAndNotesService(db);
        var person = await PersonAsync(db, owner, "נועה");

        var first = await service.AddNoteAsync(staff, person, "  מעדיפה שורה ראשונה ", CancellationToken.None);
        var second = await service.AddNoteAsync(owner, person, "שילמה במזומן על עשר כניסות", CancellationToken.None);

        first.Should().Match<PersonNoteView>(n => n.Body == "מעדיפה שורה ראשונה" && n.AuthorRole == "staff" && n.Mine && n.AuthorMembershipId == staff.MembershipId);
        var page = await service.ListNotesAsync(staff, person, null, 10, CancellationToken.None);
        page.Items.Select(n => n.Id).Should().Equal(second.Id, first.Id);
        page.Items.Select(n => n.Mine).Should().Equal(false, true);
        page.Items[0].AuthorRole.Should().Be("owner");

        var staffDeletesOwners = () => service.DeleteNoteAsync(otherStaff, person, second.Id, CancellationToken.None);
        (await staffDeletesOwners.Should().ThrowAsync<DomainRuleViolationException>()).Which.Kind.Should().Be(ViolationKind.Forbidden);
        await service.DeleteNoteAsync(staff, person, first.Id, CancellationToken.None);
        await service.DeleteNoteAsync(owner, person, second.Id, CancellationToken.None);

        (await service.ListNotesAsync(owner, person, null, 10, CancellationToken.None)).Items.Should().BeEmpty();
        var audit = (string)(await db.AsMasterAsync("SELECT string_agg(data::text, ' ') FROM audit.audit_events WHERE action LIKE 'person.note.%'"))!;
        audit.Should().Contain("noteId").And.NotContain("מעדיפה").And.NotContain("מזומן", "the audit never holds a note's text");
    }

    [Fact]
    public async Task ANote_NeedsText_UpTo1000Characters_OnALiveRecord()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var service = new PeopleTagsAndNotesService(db);
        var person = await PersonAsync(db, owner, "נועה");

        var empty = () => service.AddNoteAsync(owner, person, "   ", CancellationToken.None);
        var tooLong = () => service.AddNoteAsync(owner, person, new string('א', 1001), CancellationToken.None);
        (await empty.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("note.body_required");
        (await tooLong.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("note.too_long");
        (await service.AddNoteAsync(owner, person, new string('א', 1000), CancellationToken.None)).Body.Should().HaveLength(1000);
    }

    [Fact]
    public async Task Erase_DeletesNotesAndTagLinks_AndExport_CarriesThemWithTheAuthorsRoleOnly()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var staff = await MemberAsync(db, owner, "staff", MembershipRole.Staff);
        var service = new PeopleTagsAndNotesService(db);
        var person = await PersonAsync(db, owner, "נועה");
        var vip = await service.CreateTagAsync(owner, "VIP", 3, CancellationToken.None);
        await service.TagPersonAsync(owner, person, vip.Id, CancellationToken.None);
        await service.AddNoteAsync(staff, person, "מעדיפה שורה ראשונה", CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System);

        var export = await lifecycle.ExportAsync(owner, person, CancellationToken.None);

        export.Tags.Should().Equal("VIP");
        export.Notes.Should().ContainSingle().Which.Should().Match<ExportNoteView>(n => n.Body == "מעדיפה שורה ראשונה" && n.AuthorRole == "staff");

        await lifecycle.EraseAsync(owner, person, "the person asked", CancellationToken.None);

        (await db.AsMasterAsync("SELECT count(*) FROM people.person_notes WHERE person_id = $1", person)).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM people.person_tags WHERE person_id = $1", person)).Should().Be(0L);
        (await service.ListTagsAsync(owner, CancellationToken.None)).Single().PeopleCount.Should().Be(0, "the tag itself stays");
    }

    [Fact]
    public async Task Merge_MovesNotesAndTags_WithoutADoubledTag()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var owner = await StudioAsync(db, "studio-a");
        var people = new PeopleService(db);
        var service = new PeopleTagsAndNotesService(db);
        var keep = await people.CreateAsync(owner, new NewPerson("Noa Levi", null, null, null, null, "050-2345678"), CancellationToken.None);
        var drop = await people.CreateAsync(owner, new NewPerson("Noa L", null, null, null, null, "0502345678"), CancellationToken.None);
        var vip = await service.CreateTagAsync(owner, "VIP", 3, CancellationToken.None);
        var morning = await service.CreateTagAsync(owner, "בוקר", 1, CancellationToken.None);
        await service.TagPersonAsync(owner, keep.Person.Id, vip.Id, CancellationToken.None);
        await service.TagPersonAsync(owner, drop.Person.Id, vip.Id, CancellationToken.None);
        await service.TagPersonAsync(owner, drop.Person.Id, morning.Id, CancellationToken.None);
        await service.AddNoteAsync(owner, drop.Person.Id, "פתק על הכפול", CancellationToken.None);
        var lifecycle = new PersonLifecycleService(db, TimeProvider.System);
        var candidate = (await lifecycle.ListCandidatesAsync(owner, null, null, 10, CancellationToken.None)).Items.Single();

        await lifecycle.ResolveAsync(owner, candidate.Id, "merge", keep.Person.Id, CancellationToken.None);

        (await people.GetAsync(owner, keep.Person.Id, CancellationToken.None)).Person.Tags!.Select(t => t.Name).Should().Equal("VIP", "בוקר");
        (await service.ListNotesAsync(owner, keep.Person.Id, null, 10, CancellationToken.None)).Items.Should().ContainSingle().Which.Body.Should().Be("פתק על הכפול");
        (await db.AsMasterAsync("SELECT count(*) FROM people.person_tags WHERE person_id = $1", drop.Person.Id)).Should().Be(0L);
    }

    [Fact]
    public async Task AnotherStudiosTagsAndNotes_AreNeverSeen()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studioA = await StudioAsync(db, "studio-a");
        var studioB = await StudioAsync(db, "studio-b");
        var service = new PeopleTagsAndNotesService(db);
        var personB = await PersonAsync(db, studioB, "של B");
        var tagB = await service.CreateTagAsync(studioB, "VIP", 1, CancellationToken.None);
        await service.TagPersonAsync(studioB, personB, tagB.Id, CancellationToken.None);
        await service.AddNoteAsync(studioB, personB, "פתק של B", CancellationToken.None);

        (await service.ListTagsAsync(studioA, CancellationToken.None)).Should().BeEmpty();
        var readNotes = () => service.ListNotesAsync(studioA, personB, null, 10, CancellationToken.None);
        var tagAcross = () => service.TagPersonAsync(studioA, personB, tagB.Id, CancellationToken.None);
        (await readNotes.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("person.not_found");
        (await tagAcross.Should().ThrowAsync<DomainRuleViolationException>()).Which.Kind.Should().Be(ViolationKind.NotFound);
        (await service.CreateTagAsync(studioA, "VIP", 2, CancellationToken.None)).Name.Should().Be("VIP", "names are unique per studio only");
    }

    private static async Task<Guid> PersonAsync(MigratedDatabase db, TenantContext tenant, string name) =>
        (await new PeopleService(db).CreateAsync(tenant, new NewPerson(name, null, null, null, $"{Guid.NewGuid():N}@example.com", null), CancellationToken.None)).Person.Id;

    private static async Task<TenantContext> MemberAsync(MigratedDatabase db, TenantContext owner, string name, MembershipRole role)
    {
        var account = Guid.CreateVersion7();
        var membership = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            account,
            $"{name}-{account:N}@example.com");
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            owner.OrganizationId,
            membership,
            account,
            role.ToString().ToLowerInvariant());
        return new TenantContext(owner.OrganizationId, account, membership, role, OrganizationStatus.Active, "test");
    }

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
