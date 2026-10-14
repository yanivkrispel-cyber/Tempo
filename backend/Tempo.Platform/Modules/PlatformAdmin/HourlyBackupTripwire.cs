using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.PlatformAdmin;

/// <summary>Sends one alert to the owner. In production: the `tempo-prod-alarms` SNS topic (email).</summary>
public interface IOwnerAlert
{
    Task SendAsync(string subject, string message, CancellationToken cancellationToken);
}

public enum TripwireOutcome
{
    BelowThreshold,
    Fired,
    AlreadyFired
}

/// <summary>
/// The 10-studio tripwire (docs/26 section 10.2, ADR-0021): once active studios
/// reach <see cref="PlatformService.HourlyBackupThreshold"/>, the owner is told
/// to move to hourly backups. It fires once: a row in
/// platform_admin.tripwires records it, and the row commits only after the
/// alert was sent, so a failed send is retried by the next daily run.
/// </summary>
public sealed class HourlyBackupTripwire(IDataSourceProvider dataSources)
{
    public const string Name = "hourly-backups";

    /// <summary>Checks once. Without an alert target (development) it records and reports, nothing more.</summary>
    public async Task<(TripwireOutcome Outcome, int ActiveOrganizations)> CheckAsync(IOwnerAlert? alert, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Platform, null, null, cancellationToken);

        int active;
        await using (var count = unitOfWork.Command("SELECT count(*) FROM organizations.organizations WHERE status = 'active'"))
        {
            active = (int)(long)(await count.ExecuteScalarAsync(cancellationToken))!;
        }

        if (active < PlatformService.HourlyBackupThreshold)
        {
            return (TripwireOutcome.BelowThreshold, active);
        }

        await using (var record = unitOfWork.Command(
            "INSERT INTO platform_admin.tripwires (name, fired_at, value) VALUES ($1, now(), $2) ON CONFLICT (name) DO NOTHING",
            Name,
            active))
        {
            if (await record.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                return (TripwireOutcome.AlreadyFired, active);
            }
        }

        if (alert is not null)
        {
            await alert.SendAsync(
                $"Tempo: {active} active studios - move to hourly backups",
                $"Tempo now has {active} active studios, the threshold of {PlatformService.HourlyBackupThreshold} set in ADR-0021. "
                + "Move the production database to hourly backups (Neon point-in-time restore). This alert is sent once.",
                cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return (TripwireOutcome.Fired, active);
    }
}
