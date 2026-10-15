using FluentAssertions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Persistence;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Migration 0010 on PostgreSQL 18 (docs/29_Studio_Scheduling_and_Passes_LLD.md sections 7 and 13): the
/// capacity and entry rules hold in the schema itself, one live booking per person and session, and every
/// new table is isolated by tenant and fails closed without one.
/// </summary>
public sealed class SchedulingSchemaTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string CheckViolation = "23514";
    private const string UniqueViolation = "23505";

    private static readonly string[] TenantTables =
    [
        "scheduling.booking_policies", "scheduling.rooms", "scheduling.class_types", "scheduling.templates",
        "scheduling.sessions", "scheduling.pass_products", "scheduling.passes", "scheduling.bookings",
        "scheduling.pass_uses", "notifications.inbox_items"
    ];

    [Fact]
    public async Task Sessions_CannotBeOverbooked()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        (await db.AsMasterAsync("UPDATE scheduling.sessions SET booked_count = 1 WHERE id = $1 AND booked_count < capacity RETURNING booked_count", studio.Session))
            .Should().Be(1);
        (await db.AsMasterAsync("UPDATE scheduling.sessions SET booked_count = booked_count + 1 WHERE id = $1 AND booked_count < capacity RETURNING booked_count", studio.Session))
            .Should().BeNull("the guarded update takes no place once the session is full");

        var forced = () => db.AsMasterAsync("UPDATE scheduling.sessions SET booked_count = 2 WHERE id = $1", studio.Session);
        (await forced.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(CheckViolation);
    }

    [Fact]
    public async Task Passes_CannotSpendMoreEntriesThanTheCardHolds()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");

        var spend = () => db.AsMasterAsync("UPDATE scheduling.passes SET entries_used = 2 WHERE id = $1", studio.Pass);
        (await spend.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(CheckViolation);
    }

    [Fact]
    public async Task APerson_HoldsOneLiveBookingPerSession()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db, "studio-a");
        await BookAsync(db, studio, "booked", null);

        var again = () => BookAsync(db, studio, "waitlisted", 1);
        (await again.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(UniqueViolation);

        await db.AsMasterAsync("UPDATE scheduling.bookings SET status = 'cancelled' WHERE organization_id = $1", studio.Id);
        await BookAsync(db, studio, "booked", null);
    }

    [Fact]
    public async Task App_SeesOnlyItsOwnStudio_AndNothingWithoutOne()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var a = await StudioAsync(db, "studio-a");
        var b = await StudioAsync(db, "studio-b");
        await BookAsync(db, a, "booked", null);
        await BookAsync(db, b, "booked", null);

        await AsAppAsync(db, a.Id, async connection =>
        {
            foreach (var table in TenantTables)
            {
                (await ScalarAsync<long>(connection, $"SELECT count(*) FROM {table} WHERE organization_id = '{b.Id}'"))
                    .Should().Be(0, $"{table} hides other studios");
            }

            (await ScalarAsync<long>(connection, "SELECT count(*) FROM scheduling.sessions")).Should().Be(1);
            (await ExecuteAsync(connection, $"UPDATE scheduling.sessions SET capacity = 5 WHERE organization_id = '{b.Id}'")).Should().Be(0);
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
    public async Task SystemRoles_GetTheSchedulingPermissions()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);

        (await db.AsMasterAsync(
            "SELECT string_agg(permission_key, ',' ORDER BY permission_key) FROM authz.role_permissions WHERE role_id = '00000000-0000-7000-8000-000000000004'"))
            .Should().Be("organization.view,schedule.view", "a client sees the timetable and books through the self rule");
    }

    private sealed record Studio(Guid Id, Guid Membership, Guid Person, Guid Session, Guid Pass);

    /// <summary>A studio with an owner, a person, a class type, one session for one person and a one-entry card.</summary>
    private static async Task<Studio> StudioAsync(MigratedDatabase db, string slug)
    {
        var user = Guid.CreateVersion7();
        var org = Guid.CreateVersion7();
        var membership = Guid.CreateVersion7();
        var person = Guid.CreateVersion7();
        var classType = Guid.CreateVersion7();
        var session = Guid.CreateVersion7();
        var product = Guid.CreateVersion7();
        var pass = Guid.CreateVersion7();

        await db.AsMasterAsync("INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())", user, $"{slug}@example.com");
        await db.AsMasterAsync("INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, 'active', $3, now(), now())", org, slug, user);
        await db.AsMasterAsync("INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'owner', 'active', now(), now())", org, membership, user);
        await db.AsMasterAsync("INSERT INTO people.people (organization_id, id, display_name, status, source, created_at, updated_at) VALUES ($1, $2, 'Dana', 'active', 'staff_created', now(), now())", org, person);
        await db.AsMasterAsync("INSERT INTO scheduling.booking_policies (organization_id, updated_at) VALUES ($1, now())", org);
        await db.AsMasterAsync("INSERT INTO scheduling.class_types (organization_id, id, name, category, color, default_minutes, status, created_at, updated_at) VALUES ($1, $2, 'Reformer', 'pilates', 'rose', 50, 'active', now(), now())", org, classType);
        await db.AsMasterAsync("INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, current_date + 1, $3, now() + interval '1 day', now() + interval '1 day 50 minutes', 1, 'scheduled', now(), now())", org, session, classType);
        await db.AsMasterAsync("INSERT INTO scheduling.pass_products (organization_id, id, kind, name, entries, valid_days, status, created_at, updated_at) VALUES ($1, $2, 'punch_card', 'One class', 1, 30, 'active', now(), now())", org, product);
        await db.AsMasterAsync("INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, status, granted_by, created_at, updated_at) VALUES ($1, $2, $3, $4, current_date, current_date + 30, 1, 'active', $5, now(), now())", org, pass, person, product, membership);
        await db.AsMasterAsync("INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, created_at) VALUES ($1, $2, $3, 'booking.promoted', now())", org, Guid.CreateVersion7(), person);
        return new Studio(org, membership, person, session, pass);
    }

    private static async Task BookAsync(MigratedDatabase db, Studio studio, string status, int? position)
    {
        var booking = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, waitlist_position, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())",
            studio.Id, booking, studio.Session, studio.Person, status, position, studio.Membership);
        if (status == "booked")
        {
            await db.AsMasterAsync(
                "INSERT INTO scheduling.pass_uses (organization_id, id, pass_id, booking_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'held', now(), now())",
                studio.Id, Guid.CreateVersion7(), studio.Pass, booking);
        }
    }

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
