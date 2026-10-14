using FluentAssertions;
using Tempo.Platform.Modules.PlatformAdmin;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>The 10-studio tripwire (docs/26 section 10.2) as `tempo_platform` on PostgreSQL 18.</summary>
public sealed class TripwireTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task BelowTheThreshold_NothingHappens()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        await StudiosAsync(db, active: 9, suspended: 3);
        var alert = new RecordingAlert();

        var (outcome, active) = await new HourlyBackupTripwire(db).CheckAsync(alert, CancellationToken.None);

        outcome.Should().Be(TripwireOutcome.BelowThreshold);
        active.Should().Be(9, "suspended studios do not count");
        alert.Sent.Should().BeEmpty();
    }

    [Fact]
    public async Task AtTheThreshold_AlertsOnce()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        await StudiosAsync(db, active: 10, suspended: 0);
        var alert = new RecordingAlert();
        var tripwire = new HourlyBackupTripwire(db);

        var first = await tripwire.CheckAsync(alert, CancellationToken.None);
        var second = await tripwire.CheckAsync(alert, CancellationToken.None);

        first.Outcome.Should().Be(TripwireOutcome.Fired);
        second.Outcome.Should().Be(TripwireOutcome.AlreadyFired);
        alert.Sent.Should().ContainSingle().Which.Should().Contain("hourly backups");
        (await db.AsMasterAsync("SELECT value FROM platform_admin.tripwires WHERE name = 'hourly-backups'")).Should().Be(10);
    }

    [Fact]
    public async Task AFailedAlert_IsNotRecorded_SoTheNextRunRetries()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        await StudiosAsync(db, active: 10, suspended: 0);
        var tripwire = new HourlyBackupTripwire(db);

        var failing = () => tripwire.CheckAsync(new FailingAlert(), CancellationToken.None);
        await failing.Should().ThrowAsync<InvalidOperationException>();
        var retry = await tripwire.CheckAsync(new RecordingAlert(), CancellationToken.None);

        retry.Outcome.Should().Be(TripwireOutcome.Fired);
    }

    [Fact]
    public async Task WithoutAnAlertTarget_RecordsAndReports()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        await StudiosAsync(db, active: 11, suspended: 0);

        var (outcome, active) = await new HourlyBackupTripwire(db).CheckAsync(alert: null, CancellationToken.None);

        outcome.Should().Be(TripwireOutcome.Fired);
        active.Should().Be(11);
    }

    private static async Task StudiosAsync(MigratedDatabase db, int active, int suspended)
    {
        var owner = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            owner);
        for (var i = 0; i < active + suspended; i++)
        {
            await db.AsMasterAsync(
                "INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, $3, $4, now(), now())",
                Guid.CreateVersion7(),
                $"studio-{i:D3}",
                i < active ? "active" : "suspended",
                owner);
        }
    }

    private sealed class RecordingAlert : IOwnerAlert
    {
        public List<string> Sent { get; } = [];

        public Task SendAsync(string subject, string message, CancellationToken cancellationToken)
        {
            Sent.Add(subject);
            return Task.CompletedTask;
        }
    }

    private sealed class FailingAlert : IOwnerAlert
    {
        public Task SendAsync(string subject, string message, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("SNS is down");
    }
}
