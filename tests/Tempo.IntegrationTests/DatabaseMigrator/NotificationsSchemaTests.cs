using FluentAssertions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Persistence;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Migration 0014 on PostgreSQL 18 (docs/30_Communications_LLD.md sections 5 to 8; day board #176, P2): every new
/// notifications table is isolated by tenant and fails closed without one, platform-default templates are visible
/// to every studio, and the rules the router relies on hold in the schema itself.
/// </summary>
public sealed class NotificationsSchemaTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string CheckViolation = "23514";
    private const string UniqueViolation = "23505";
    private const string InsufficientPrivilege = "42501";

    private static readonly string[] TenantTables =
    [
        "notifications.studio_settings", "notifications.preferences", "notifications.quiet_hours",
        "notifications.reminder_switches", "notifications.preference_versions", "notifications.push_subscriptions",
        "notifications.requests", "notifications.deliveries"
    ];

    [Fact]
    public async Task App_SeesOnlyItsOwnStudio_AndNothingWithoutOne()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        var b = await StudioAsync(db, "studio-b");

        await AsAppAsync(db, a.Id, async connection =>
        {
            foreach (var table in TenantTables)
            {
                (await ScalarAsync<long>(connection, $"SELECT count(*) FROM {table}")).Should().Be(1, $"{table} shows the own studio's row");
                (await ScalarAsync<long>(connection, $"SELECT count(*) FROM {table} WHERE organization_id = '{b.Id}'"))
                    .Should().Be(0, $"{table} hides other studios");
            }

            (await ExecuteAsync(connection, $"UPDATE notifications.deliveries SET status = 'dead' WHERE organization_id = '{b.Id}'")).Should().Be(0);
            (await ExecuteAsync(connection, $"DELETE FROM notifications.push_subscriptions WHERE organization_id = '{b.Id}'")).Should().Be(0);
        });

        await AsAppAsync(db, null, async connection =>
        {
            foreach (var table in TenantTables)
            {
                (await ScalarAsync<long>(connection, $"SELECT count(*) FROM {table}")).Should().Be(0, $"{table} fails closed");
            }
        });
    }

    [Fact]
    public async Task Templates_PlatformDefaultsAreVisibleToEveryStudio_AStudioCannotWriteThem()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        var b = await StudioAsync(db, "studio-b");
        await TemplateAsync(db, null);
        await TemplateAsync(db, b.Id);

        await AsAppAsync(db, a.Id, async connection =>
        {
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM notifications.templates")).Should().Be(1, "the platform default, not studio b's");
            (await ScalarAsync<long>(connection, "SELECT count(*) FROM notifications.templates WHERE organization_id IS NULL")).Should().Be(1);
        });

        var write = () => AsAppAsync(db, a.Id, connection => ExecuteAsync(connection, "UPDATE notifications.templates SET body = 'x'"));
        (await write.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(InsufficientPrivilege);
    }

    [Fact]
    public async Task OneActiveTemplate_PerStudioKindLocaleAndChannel()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        await TemplateAsync(db, null);

        var second = () => TemplateAsync(db, null, version: 2);
        (await second.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(UniqueViolation, "the platform default has one active row too");
    }

    [Fact]
    public async Task TheInbox_CannotBeSwitchedOff()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var off = () => db.AsMasterAsync(
            "INSERT INTO notifications.preferences (organization_id, person_id, \"group\", channel, enabled, updated_at) VALUES ($1, $2, 'studio', 'inbox', false, now())",
            studio.Id, studio.Person);
        (await off.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(CheckViolation);
    }

    [Fact]
    public async Task ARequest_IsWrittenOncePerDedupeKey_AndOneDeliveryPerChannel()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var again = () => RequestAsync(db, studio.Id, studio.Person, "booking.promoted:fixed");
        (await again.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(UniqueViolation);

        var twice = () => DeliveryAsync(db, studio.Id, studio.Request, "inbox", "delivered", null);
        (await twice.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(UniqueViolation);
    }

    [Fact]
    public async Task ASkippedDelivery_CarriesItsReason_AndOnlyASkippedOne()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var noReason = () => DeliveryAsync(db, studio.Id, studio.Request, "push", "skipped", null);
        (await noReason.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(CheckViolation);
        var reasonOnSent = () => DeliveryAsync(db, studio.Id, studio.Request, "push", "accepted", "quiet_hours");
        (await reasonOnSent.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(CheckViolation);

        await DeliveryAsync(db, studio.Id, studio.Request, "push", "skipped", "no_subscription");
    }

    [Fact]
    public async Task PushSubscriptions_AreHttpsOnly_AndOncePerEndpoint()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var http = () => SubscriptionAsync(db, studio.Id, studio.Person, "http://push.example.com/abc");
        (await http.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(CheckViolation);
        var again = () => SubscriptionAsync(db, studio.Id, studio.Person, "https://push.example.com/1");
        (await again.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(UniqueViolation);
    }

    private sealed record Studio(Guid Id, Guid Person, Guid Request);

    /// <summary>A studio with an owner, a person, and one row in every notifications table for that person.</summary>
    private static async Task<Studio> StudioAsync(MigratedDatabase db, string slug)
    {
        var user = Guid.CreateVersion7();
        var org = Guid.CreateVersion7();
        var person = Guid.CreateVersion7();

        await db.AsMasterAsync("INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())", user, $"{slug}@example.com");
        await db.AsMasterAsync("INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, 'active', $3, now(), now())", org, slug, user);
        await db.AsMasterAsync("INSERT INTO people.people (organization_id, id, display_name, status, source, created_at, updated_at) VALUES ($1, $2, 'Dana', 'active', 'staff_created', now(), now())", org, person);
        await db.AsMasterAsync("INSERT INTO notifications.studio_settings (organization_id, updated_at) VALUES ($1, now())", org);
        await db.AsMasterAsync("INSERT INTO notifications.preferences (organization_id, person_id, \"group\", channel, enabled, updated_at) VALUES ($1, $2, 'reminders', 'push', false, now())", org, person);
        await db.AsMasterAsync("INSERT INTO notifications.quiet_hours (organization_id, person_id, starts_local, ends_local, updated_at) VALUES ($1, $2, '23:00', '07:00', now())", org, person);
        await db.AsMasterAsync("INSERT INTO notifications.reminder_switches (organization_id, person_id, reminder, enabled, updated_at) VALUES ($1, $2, 'class_soon', false, now())", org, person);
        await db.AsMasterAsync("INSERT INTO notifications.preference_versions (organization_id, person_id, updated_at) VALUES ($1, $2, now())", org, person);
        await SubscriptionAsync(db, org, person, "https://push.example.com/1");
        var request = await RequestAsync(db, org, person, "booking.promoted:fixed");
        await DeliveryAsync(db, org, request, "inbox", "delivered", null);
        return new Studio(org, person, request);
    }

    private static Task<object?> TemplateAsync(MigratedDatabase db, Guid? org, int version = 1) =>
        db.AsMasterAsync(
            "INSERT INTO notifications.templates (id, organization_id, kind, locale, channel, version, subject, body, status, created_at) VALUES ($1, $2, 'booking.promoted', 'he', 'push', $3, 'נכנסת לשיעור', 'התפנה מקום', 'active', now())",
            Guid.CreateVersion7(), org, version);

    private static Task<object?> SubscriptionAsync(MigratedDatabase db, Guid org, Guid person, string endpoint) =>
        db.AsMasterAsync(
            "INSERT INTO notifications.push_subscriptions (organization_id, id, person_id, endpoint, p256dh, auth, device_label, created_at) VALUES ($1, $2, $3, $4, 'BPk', 'aGk', 'Chrome, Android', now())",
            org, Guid.CreateVersion7(), person, endpoint);

    private static async Task<Guid> RequestAsync(MigratedDatabase db, Guid org, Guid person, string dedupeKey)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO notifications.requests (organization_id, id, kind, person_id, subject_type, subject_id, dedupe_key, created_at) VALUES ($1, $2, 'booking.promoted', $3, 'booking', $4, $5, now())",
            org, id, person, Guid.CreateVersion7(), dedupeKey);
        return id;
    }

    private static Task<object?> DeliveryAsync(MigratedDatabase db, Guid org, Guid request, string channel, string status, string? skipReason) =>
        db.AsMasterAsync(
            "INSERT INTO notifications.deliveries (organization_id, id, request_id, channel, status, skip_reason, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
            org, Guid.CreateVersion7(), request, channel, status, skipReason);

    /// <summary>One transaction as `tempo_app` with the tenant setting, as the API runs.</summary>
    private static async Task AsAppAsync(MigratedDatabase db, Guid? organizationId, Func<NpgsqlConnection, Task> work)
    {
        await using var connection = new NpgsqlConnection(db.ConnectionString(DatabaseRole.Application));
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteAsync(connection, $"SELECT set_config('app.organization_id', '{organizationId?.ToString() ?? string.Empty}', true)");
        await work(connection);
        await transaction.CommitAsync();
    }

    private static async Task<T> ScalarAsync<T>(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    private static async Task<int> ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteNonQueryAsync();
    }
}
