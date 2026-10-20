using FluentAssertions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.PlatformAdmin;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The operator removes a suspended studio (docs/32 section 10, A-3) on PostgreSQL 18 as `tempo_platform`. The main
/// test walks the schema catalog twice: before the delete, every table with an `organization_id` must hold a row of
/// the studio (so a table added later fails here until its seed is added), and after it none may. Fictional data only.
/// </summary>
public sealed class OrganizationRemovalTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static readonly OperatorContext Operator = new(Guid.CreateVersion7(), "operator@example.com", "test");

    [Fact]
    public async Task RemovingASuspendedStudio_LeavesNoRowOfItAnywhere_AndKeepsOneAuditRow()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "gone");
        var neighbour = await StudioAsync(db, "stays");
        await SeedEveryTenantTableAsync(db, studio);
        await SeedEveryTenantTableAsync(db, neighbour);
        await SuspendAsync(db, studio);

        (await TenantTablesWithoutRowsAsync(db, studio.OrganizationId)).Should().BeEmpty("the seed must cover every tenant table");
        var neighbourRows = await RowsOfAsync(db, neighbour.OrganizationId);

        await new PlatformService(db).DeleteOrganizationAsync(Operator, studio.OrganizationId, " e2e-gone ", 0, CancellationToken.None);

        (await RowsOfAsync(db, studio.OrganizationId)).Should().Be(0);
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.organizations WHERE id = $1", studio.OrganizationId)).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM authz.role_permissions p WHERE NOT EXISTS (SELECT 1 FROM authz.roles r WHERE r.id = p.role_id)")).Should().Be(0L);
        (await RowsOfAsync(db, neighbour.OrganizationId)).Should().Be(neighbourRows, "another studio loses nothing");
        (await db.AsMasterAsync(
            "SELECT action || ':' || coalesce(organization_id::text, '-') || ':' || (data->>'name') FROM audit.audit_events WHERE target_id = $1",
            studio.OrganizationId)).Should().Be("platform.organization.deleted:-:e2e-gone");
    }

    [Fact]
    public async Task AnActiveStudio_Is409_AndTheFunctionRefusesItToo()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "active");

        var delete = () => new PlatformService(db).DeleteOrganizationAsync(Operator, studio.OrganizationId, "e2e-active", 0, CancellationToken.None);

        (await delete.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("organization.not_suspended");
        var direct = () => db.AsMasterAsync("SELECT platform_admin.delete_organization($1)", studio.OrganizationId);
        (await direct.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("55000");
    }

    [Fact]
    public async Task AStudioSuspendedTooRecently_Is409_WithWhenItCanGo()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "recent");
        await SuspendAsync(db, studio);

        var delete = () => new PlatformService(db).DeleteOrganizationAsync(Operator, studio.OrganizationId, "e2e-recent", 30, CancellationToken.None);

        var refused = (await delete.Should().ThrowAsync<DomainRuleViolationException>()).Which;
        refused.Code.Should().Be("organization.suspended_too_recently");
        ((DateTimeOffset)refused.Extensions!["deletableFrom"]!).Should().BeCloseTo(DateTimeOffset.UtcNow.AddDays(30), TimeSpan.FromMinutes(5));
    }

    [Fact]
    public async Task AWrongName_Is400_AndNothingIsDeleted()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "named");
        await SuspendAsync(db, studio);

        var delete = () => new PlatformService(db).DeleteOrganizationAsync(Operator, studio.OrganizationId, "e2e-other", 0, CancellationToken.None);

        (await delete.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("organization.name_mismatch");
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.organizations WHERE id = $1", studio.OrganizationId)).Should().Be(1L);
    }

    [Fact]
    public async Task ThePlatformRole_CannotDeleteAnyTenantRowItself()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "guarded");
        await using var connection = new NpgsqlConnection(db.ConnectionString(Tempo.Platform.BuildingBlocks.Persistence.DatabaseRole.Platform));
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DELETE FROM people.people WHERE organization_id = '{studio.OrganizationId}'", connection);

        var delete = () => command.ExecuteNonQueryAsync();

        (await delete.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db, string name)
    {
        var owner = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            owner, $"e2e-{name}-owner@example.com");
        var organization = await new OrganizationService(db).CreateAsync(new AccountSnapshot(owner, AccountStatus.Active, true), new NewOrganization($"e2e-{name}", $"e2e-{name}", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(owner, organization.Id, CancellationToken.None))!;
        return new TenantContext(organization.Id, owner, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }

    private static async Task SuspendAsync(MigratedDatabase db, TenantContext studio) =>
        await new PlatformService(db).SetStatusAsync(Operator, studio.OrganizationId, OrganizationStatus.Suspended, "e2e cleanup run", CancellationToken.None);

    /// <summary>One row of the studio in every tenant table the studio's creation did not fill already.</summary>
    private static async Task SeedEveryTenantTableAsync(MigratedDatabase db, TenantContext studio)
    {
        await new InvitationService(db, new AccountProfiles(db), new AttemptLimiter(db)).CreateAsync(studio, $"e2e-{studio.OrganizationId:N}@example.com", MembershipRole.Client, CancellationToken.None);
        await db.AsMasterAsync(
            """
            DO $seed$
            DECLARE
                org uuid := '__ORG__';
                owner_membership uuid := '__MEMBERSHIP__';
                person uuid := gen_random_uuid();
                other_person uuid := gen_random_uuid();
                custom_role uuid := gen_random_uuid();
                room uuid := gen_random_uuid();
                spot uuid := gen_random_uuid();
                class_type uuid := gen_random_uuid();
                template uuid := gen_random_uuid();
                session uuid := gen_random_uuid();
                product uuid := gen_random_uuid();
                pass uuid := gen_random_uuid();
                booking uuid := gen_random_uuid();
                request uuid := gen_random_uuid();
                admin_account uuid := gen_random_uuid();
                admin_membership uuid := gen_random_uuid();
                tag uuid := gen_random_uuid();
                subscription uuid;
            BEGIN
                INSERT INTO people.people (organization_id, id, display_name, status, source, created_at, updated_at) VALUES
                    (org, person, 'מתאמנת לדוגמה', 'active', 'staff_created', now(), now()),
                    (org, other_person, 'אפוטרופוס לדוגמה', 'active', 'staff_created', now(), now());
                INSERT INTO authz.roles (id, organization_id, key, display_name, is_system, created_at, updated_at) VALUES (custom_role, org, 'front_desk', 'קבלה', false, now(), now());
                INSERT INTO authz.role_permissions (role_id, permission_key) VALUES (custom_role, 'schedule.view');
                INSERT INTO people.contact_points (organization_id, id, person_id, type, value, is_primary, verified, created_at, updated_at) VALUES (org, gen_random_uuid(), person, 'email', 'e2e-person@example.com', true, false, now(), now());
                INSERT INTO people.consents (organization_id, id, person_id, purpose, channel, state, method, text_version, occurred_at) VALUES (org, gen_random_uuid(), person, 'marketing', 'email', 'granted', 'self', 'v1', now());
                INSERT INTO people.person_relationships (organization_id, id, from_person_id, to_person_id, type, created_at) VALUES (org, gen_random_uuid(), other_person, person, 'guardian_of', now());
                INSERT INTO people.duplicate_candidates (organization_id, id, person_a_id, person_b_id, reason, status, created_at, updated_at) VALUES (org, gen_random_uuid(), least(person, other_person), greatest(person, other_person), 'email', 'open', now(), now());
                INSERT INTO people.health_declarations (organization_id, id, person_id, form_version, signer_role, has_yes, signed_at, expires_at, key_version, answers_ciphertext, signed_name_ciphertext, created_at)
                    VALUES (org, gen_random_uuid(), person, 1, 'self', false, now(), now() + interval '1 year', 1, '\x00', '\x00', now());
                INSERT INTO people.tags (organization_id, id, name, color, created_at, updated_at) VALUES (org, tag, 'בוקר', 1, now(), now());
                INSERT INTO people.person_tags (organization_id, person_id, tag_id, created_at) VALUES (org, person, tag, now());
                INSERT INTO people.person_notes (organization_id, id, person_id, author_membership_id, author_role, body, created_at)
                    VALUES (org, gen_random_uuid(), person, owner_membership, 'owner', 'מעדיפה שורה ראשונה', now());
                INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES (admin_account, 'active', 'e2e-admin-' || admin_account || '@example.com', true, now(), now(), now());
                INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES (org, admin_membership, admin_account, 'admin', 'active', now(), now());
                INSERT INTO organizations.ownership_transfers (organization_id, id, from_membership_id, to_membership_id, status, expires_at, created_at, updated_at)
                    VALUES (org, gen_random_uuid(), owner_membership, admin_membership, 'cancelled', now(), now(), now());

                SELECT id INTO subscription FROM billing.subscriptions WHERE organization_id = org LIMIT 1;
                INSERT INTO billing.billing_accounts (organization_id, created_at, updated_at) VALUES (org, now(), now()) ON CONFLICT DO NOTHING;
                INSERT INTO billing.subscription_events (organization_id, id, subscription_id, to_state, cause, actor_type, occurred_at) VALUES (org, gen_random_uuid(), subscription, 'active', 'e2e', 'system', now());
                INSERT INTO billing.entitlement_overrides (organization_id, key, value, reason, created_by_operator, created_at) VALUES (org, 'rooms.max', '5', 'e2e', gen_random_uuid(), now());

                INSERT INTO scheduling.booking_policies (organization_id, updated_at) VALUES (org, now()) ON CONFLICT DO NOTHING;
                INSERT INTO scheduling.rooms (organization_id, id, name, default_capacity, status, created_at, updated_at) VALUES (org, room, 'חדר', 10, 'active', now(), now());
                INSERT INTO scheduling.class_types (organization_id, id, name, category, color, default_minutes, status, created_at, updated_at) VALUES (org, class_type, 'פילאטיס', 'pilates', 'rose', 50, 'active', now(), now());
                INSERT INTO scheduling.templates (organization_id, id, class_type_id, weekday, local_start, minutes, capacity, valid_from, created_at, updated_at) VALUES (org, template, class_type, 0, '09:00', 50, 10, current_date, now(), now());
                INSERT INTO scheduling.sessions (organization_id, id, template_id, local_date, class_type_id, starts_at, ends_at, room_id, capacity, status, created_at, updated_at)
                    VALUES (org, session, template, current_date, class_type, now(), now() + interval '50 minutes', room, 10, 'scheduled', now(), now());
                INSERT INTO scheduling.pass_products (organization_id, id, kind, name, entries, valid_days, status, created_at, updated_at) VALUES (org, product, 'punch_card', 'כרטיסייה', 10, 90, 'active', now(), now());
                INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, status, granted_by, created_at, updated_at) VALUES (org, pass, person, product, current_date, current_date + 90, 10, 'active', owner_membership, now(), now());
                INSERT INTO scheduling.pass_freezes (organization_id, id, pass_id, starts_on, ends_on, created_by, created_at) VALUES (org, gen_random_uuid(), pass, current_date + 10, current_date + 20, owner_membership, now());
                INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, booked_by, created_at, updated_at) VALUES (org, booking, session, person, 'booked', owner_membership, now(), now());
                INSERT INTO scheduling.pass_uses (organization_id, id, pass_id, booking_id, status, created_at, updated_at) VALUES (org, gen_random_uuid(), pass, booking, 'held', now(), now());
                INSERT INTO scheduling.member_goals (organization_id, person_id, monthly_goal, updated_at) VALUES (org, person, 8, now());
                INSERT INTO scheduling.room_spots (organization_id, room_id, id, label, row_index, col_index, kind, status, created_at, updated_at) VALUES (org, room, spot, '1', 0, 0, 'reformer', 'active', now(), now());
                INSERT INTO scheduling.spot_preferences (organization_id, person_id, room_id, spot_id, updated_at) VALUES (org, person, room, spot, now());
                INSERT INTO people.buddy_codes (organization_id, person_id, code_hash, expires_at, created_at) VALUES (org, person, decode('00', 'hex'), now(), now());
                INSERT INTO people.buddy_links (organization_id, person_low, person_high, created_at) VALUES (org, least(person, other_person), greatest(person, other_person), now());
                INSERT INTO people.buddy_attempts (organization_id, person_id, attempted_at) VALUES (org, person, now());
                INSERT INTO media.media_objects (organization_id, id, purpose, owner_id, status, content_type, declared_bytes, created_by, created_at, updated_at) VALUES (org, gen_random_uuid(), 'avatar', person, 'ready', 'image/png', 100, owner_membership, now(), now());
                INSERT INTO organizations.staff_profiles (organization_id, membership_id, headline, updated_at) VALUES (org, owner_membership, 'מורה', now());
                INSERT INTO organizations.brands (organization_id, app_name, accent_id, updated_at) VALUES (org, 'סטודיו', 'ocean', now());
                INSERT INTO people.checkin_attempts (organization_id, membership_id, attempted_at) VALUES (org, owner_membership, now());

                INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, created_at) VALUES (org, gen_random_uuid(), person, 'booking.confirmed', now());
                INSERT INTO notifications.session_messages (organization_id, id, session_id, sent_by, body, recipients, created_at) VALUES (org, gen_random_uuid(), session, owner_membership, 'שיעור מבוטל', 1, now());
                INSERT INTO notifications.templates (organization_id, id, kind, locale, channel, version, body, status, created_at) VALUES (org, gen_random_uuid(), 'booking.confirmed', 'he', 'inbox', 1, 'נרשמת', 'active', now());
                INSERT INTO notifications.studio_settings (organization_id, updated_at) VALUES (org, now()) ON CONFLICT DO NOTHING;
                INSERT INTO notifications.preferences (organization_id, person_id, "group", channel, enabled, updated_at) VALUES (org, person, 'bookings', 'push', false, now());
                INSERT INTO notifications.quiet_hours (organization_id, person_id, starts_local, ends_local, updated_at) VALUES (org, person, '22:00', '07:00', now());
                INSERT INTO notifications.reminder_switches (organization_id, person_id, reminder, enabled, updated_at) VALUES (org, person, 'class_soon', false, now());
                INSERT INTO notifications.preference_versions (organization_id, person_id, updated_at) VALUES (org, person, now());
                INSERT INTO notifications.push_subscriptions (organization_id, id, person_id, endpoint, p256dh, auth, device_label, created_at) VALUES (org, gen_random_uuid(), person, 'https://push.example.com/e2e', 'k', 'a', 'טלפון', now());
                INSERT INTO notifications.requests (organization_id, id, kind, person_id, subject_type, subject_id, dedupe_key, created_at) VALUES (org, request, 'booking.confirmed', person, 'booking', booking, 'e2e-' || booking, now());
                INSERT INTO notifications.deliveries (organization_id, id, request_id, channel, status, created_at, updated_at) VALUES (org, gen_random_uuid(), request, 'inbox', 'queued', now(), now());
                INSERT INTO notifications.announcements (organization_id, id, sent_by, subject, body, recipients, created_at) VALUES (org, gen_random_uuid(), owner_membership, 'הודעה', 'תוכן לדוגמה', 1, now());
                INSERT INTO organizations.public_pages (organization_id, enabled, intro_product_id, updated_at, updated_by) VALUES (org, true, product, now(), owner_membership);
                INSERT INTO marketing.links (organization_id, id, code, channel, template, session_id, target_kind, target_id, created_by, created_at) VALUES (org, gen_random_uuid(), 'abc123', 'story', 'week', session, 'session', session, owner_membership, now());
                INSERT INTO marketing.links (organization_id, id, code, channel, target_kind, target_id, created_by, created_at) VALUES (org, gen_random_uuid(), 'abc124', 'story', 'offer', product, owner_membership, now());
                INSERT INTO marketing.referral_rewards (organization_id, friend_membership_id, referrer_membership_id, pass_id, rewarded_at) VALUES (org, admin_membership, owner_membership, pass, now());
            END
            $seed$;
            """.Replace("__ORG__", studio.OrganizationId.ToString(), StringComparison.Ordinal).Replace("__MEMBERSHIP__", studio.MembershipId.ToString(), StringComparison.Ordinal));
    }

    /// <summary>Every base table with an `organization_id` column, from the catalog.</summary>
    private static async Task<List<string>> TenantTablesAsync(MigratedDatabase db)
    {
        var tables = new List<string>();
        await using var connection = new NpgsqlConnection(db.ConnectionString(Tempo.Platform.BuildingBlocks.Persistence.DatabaseRole.Platform));
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT format('%I.%I', n.nspname, c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
            WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY 1
            """,
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            tables.Add(reader.GetString(0));
        }

        return tables;
    }

    private static async Task<List<string>> TenantTablesWithoutRowsAsync(MigratedDatabase db, Guid organizationId)
    {
        var empty = new List<string>();
        foreach (var table in await TenantTablesAsync(db))
        {
            if ((long)(await db.AsMasterAsync($"SELECT count(*) FROM {table} WHERE organization_id = $1", organizationId))! == 0)
            {
                empty.Add(table);
            }
        }

        return empty;
    }

    private static async Task<long> RowsOfAsync(MigratedDatabase db, Guid organizationId)
    {
        long rows = 0;
        foreach (var table in await TenantTablesAsync(db))
        {
            rows += (long)(await db.AsMasterAsync($"SELECT count(*) FROM {table} WHERE organization_id = $1", organizationId))!;
        }

        return rows;
    }
}
