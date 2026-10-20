using System.Text.RegularExpressions;
using FluentAssertions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Persistence;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Migration 0036 on PostgreSQL 18 (board #404, SL-1 to SL-10, SK1): a link has exactly one target and it belongs to
/// its studio, a member may switch only her name on her own link, listed products keep their limits, and the stage A
/// intro product and session links come over as an offer and as session targets.
/// </summary>
public sealed partial class ShareLinkSchemaTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string CheckViolation = "23514";
    private const string ForeignKeyViolation = "23503";
    private const string InsufficientPrivilege = "42501";

    [Fact]
    public async Task ALink_HasExactlyOneTarget_OfItsOwnStudio()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        var b = await StudioAsync(db, "studio-b");

        await LinkAsync(db, a, "schedule", null, null);
        await LinkAsync(db, a, "prices", null, null);
        await LinkAsync(db, a, "session", a.Session, a.Session);
        await LinkAsync(db, a, "offer", a.Product, null);

        (await FailsAsync(() => LinkAsync(db, a, "session", a.Session, null))).Should().Be(CheckViolation, "a session target keeps its session_id");
        (await FailsAsync(() => LinkAsync(db, a, "session", null, null))).Should().Be(CheckViolation, "a session target names one");
        (await FailsAsync(() => LinkAsync(db, a, "schedule", a.Session, null))).Should().Be(CheckViolation, "the week names nothing");
        (await FailsAsync(() => LinkAsync(db, a, "prices", null, a.Session))).Should().Be(CheckViolation, "only a session target has a session");
        (await FailsAsync(() => LinkAsync(db, a, "offer", null, null))).Should().Be(CheckViolation, "an offer names its product");
        (await FailsAsync(() => LinkAsync(db, a, "offer", b.Product, null))).Should().Be(ForeignKeyViolation, "another studio's product is not an offer here");
        (await FailsAsync(() => LinkAsync(db, a, "session", b.Session, b.Session))).Should().Be(ForeignKeyViolation, "nor another studio's session");
        (await FailsAsync(() => LinkAsync(db, a, "everything", null, null))).Should().Be(CheckViolation);
    }

    [Fact]
    public async Task TheApp_SwitchesOnlyTheNameOnALink()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        var link = await LinkAsync(db, a, "session", a.Session, a.Session);
        (await db.AsMasterAsync("SELECT show_name FROM marketing.links WHERE id = $1", link)).Should().Be(true, "SL-8: on by default");

        await AsAppAsync(db, a.Id, async connection =>
        {
            (await ExecuteAsync(connection, $"UPDATE marketing.links SET show_name = false WHERE id = '{link}'")).Should().Be(1);
        });
        (await db.AsMasterAsync("SELECT show_name FROM marketing.links WHERE id = $1", link)).Should().Be(false);

        var retarget = () => AsAppAsync(db, a.Id, connection => ExecuteAsync(connection, $"UPDATE marketing.links SET target_kind = 'prices', target_id = NULL, session_id = NULL WHERE id = '{link}'"));
        (await retarget.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege, "a link's target never changes");
    }

    [Fact]
    public async Task ListedProducts_KeepTheirLimits()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        (await db.AsMasterAsync("SELECT public_listed FROM scheduling.pass_products WHERE id = $1", a.Product)).Should().Be(false, "nothing is listed until the owner says so");

        await db.AsMasterAsync("UPDATE scheduling.pass_products SET public_listed = true, public_order = 2, newcomers_only = true, public_until = current_date + 10, public_blurb = $2 WHERE id = $1", a.Product, new string('א', 120));
        (await FailsAsync(() => db.AsMasterAsync("UPDATE scheduling.pass_products SET public_blurb = $2 WHERE id = $1", a.Product, new string('א', 121)))).Should().Be(CheckViolation);
        (await FailsAsync(() => db.AsMasterAsync("UPDATE scheduling.pass_products SET public_blurb = '' WHERE id = $1", a.Product))).Should().Be(CheckViolation);
        (await FailsAsync(() => db.AsMasterAsync("UPDATE scheduling.pass_products SET public_order = 1000 WHERE id = $1", a.Product))).Should().Be(CheckViolation);
    }

    [Fact]
    public async Task StageA_IntroProducts_AndSessionLinks_ComeOverAsTargets()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        var other = Guid.CreateVersion7();
        await db.AsMasterAsync("INSERT INTO scheduling.pass_products (organization_id, id, kind, name, entries, valid_days, status, created_at, updated_at) VALUES ($1, $2, 'punch_card', 'Ten classes', 10, 180, 'active', now(), now())", a.Id, other);
        await db.AsMasterAsync("INSERT INTO organizations.public_pages (organization_id, enabled, intro_product_id, updated_at, updated_by) VALUES ($1, true, $2, now(), $3)", a.Id, a.Product, a.Membership);

        // Rows as stage A wrote them: no target, a session on the card link.
        var script = Script();
        foreach (var name in new[] { "links_target_id_check", "links_target_session_check" })
        {
            await db.AsMasterAsync($"ALTER TABLE marketing.links DROP CONSTRAINT {name}");
        }

        var card = Guid.CreateVersion7();
        var referral = Guid.CreateVersion7();
        await db.AsMasterAsync("INSERT INTO marketing.links (organization_id, id, code, channel, session_id, created_by, created_at) VALUES ($1, $2, 'card001', 'member_card', $3, $4, now())", a.Id, card, a.Session, a.Membership);
        await db.AsMasterAsync("INSERT INTO marketing.links (organization_id, id, code, channel, created_by, created_at) VALUES ($1, $2, 'frnd001', 'referral', $3, now())", a.Id, referral, a.Membership);

        await db.AsMasterAsync(Section(script, "links"));
        await db.AsMasterAsync(Section(script, "products"));
        foreach (Match constraint in LinkChecks().Matches(script))
        {
            await db.AsMasterAsync(constraint.Value);
        }

        (await db.AsMasterAsync("SELECT target_kind || ':' || target_id FROM marketing.links WHERE id = $1", card)).Should().Be($"session:{a.Session}");
        (await db.AsMasterAsync("SELECT target_kind || ':' || coalesce(target_id::text, '-') FROM marketing.links WHERE id = $1", referral)).Should().Be("schedule:-");
        (await db.AsMasterAsync("SELECT public_listed AND newcomers_only AND public_order = 0 FROM scheduling.pass_products WHERE id = $1", a.Product)).Should().Be(true, "the intro product is now a listed offer for newcomers");
        (await db.AsMasterAsync("SELECT public_listed OR newcomers_only FROM scheduling.pass_products WHERE id = $1", other)).Should().Be(false);
        (await db.AsMasterAsync("SELECT intro_product_id FROM organizations.public_pages WHERE organization_id = $1", a.Id)).Should().Be(a.Product, "readable for one release");
    }

    private sealed record Studio(Guid Id, Guid Membership, Guid Session, Guid Product);

    private static async Task<Studio> StudioAsync(MigratedDatabase db, string slug)
    {
        var user = Guid.CreateVersion7();
        var org = Guid.CreateVersion7();
        var membership = Guid.CreateVersion7();
        var classType = Guid.CreateVersion7();
        var session = Guid.CreateVersion7();
        var product = Guid.CreateVersion7();

        await db.AsMasterAsync("INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())", user, $"{slug}@example.com");
        await db.AsMasterAsync("INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, 'active', $3, now(), now())", org, slug, user);
        await db.AsMasterAsync("INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'owner', 'active', now(), now())", org, membership, user);
        await db.AsMasterAsync("INSERT INTO scheduling.class_types (organization_id, id, name, category, color, default_minutes, status, created_at, updated_at) VALUES ($1, $2, 'Reformer', 'pilates', 'rose', 50, 'active', now(), now())", org, classType);
        await db.AsMasterAsync("INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, current_date + 1, $3, now() + interval '1 day', now() + interval '1 day 50 minutes', 8, 'scheduled', now(), now())", org, session, classType);
        await db.AsMasterAsync("INSERT INTO scheduling.pass_products (organization_id, id, kind, name, entries, valid_days, status, created_at, updated_at) VALUES ($1, $2, 'punch_card', 'Three trial classes', 3, 35, 'active', now(), now())", org, product);
        return new Studio(org, membership, session, product);
    }

    private static async Task<Guid> LinkAsync(MigratedDatabase db, Studio studio, string kind, Guid? target, Guid? session)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO marketing.links (organization_id, id, code, channel, target_kind, target_id, session_id, created_by, created_at) VALUES ($1, $2, $3, 'story', $4, $5, $6, $7, now())",
            studio.Id, id, id.ToString("N")[^8..], kind, target, session, studio.Membership);
        return id;
    }

    private static async Task<string?> FailsAsync(Func<Task> act)
    {
        try
        {
            await act();
            return null;
        }
        catch (PostgresException error)
        {
            return error.SqlState;
        }
    }

    private static string Script()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Tempo.sln")))
        {
            directory = directory.Parent;
        }

        return File.ReadAllText(Path.Combine(directory!.FullName, "backend", "Tempo.DatabaseMigrator", "Migrations", "Scripts", "0036_share_links_by_intent.sql"));
    }

    private static string Section(string script, string name)
    {
        var begin = script.IndexOf($"-- backfill:begin {name}", StringComparison.Ordinal);
        var end = script.IndexOf($"-- backfill:end {name}", StringComparison.Ordinal);
        begin.Should().BeGreaterThan(0);
        return script[(script.IndexOf('\n', begin) + 1)..end].Trim().TrimEnd(';');
    }

    [GeneratedRegex(@"ALTER TABLE marketing\.links ADD CONSTRAINT links_target_(id|session)_check\s+CHECK \(.*?\);\r?\n", RegexOptions.Singleline)]
    private static partial Regex LinkChecks();

    private static async Task AsAppAsync(MigratedDatabase db, Guid? organizationId, Func<NpgsqlConnection, Task> work)
    {
        await using var connection = new NpgsqlConnection(db.ConnectionString(DatabaseRole.Application));
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteAsync(connection, $"SELECT set_config('app.organization_id', '{organizationId?.ToString() ?? string.Empty}', true)");
        await work(connection);
        await transaction.CommitAsync();
    }

    private static async Task<int> ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteNonQueryAsync();
    }
}
