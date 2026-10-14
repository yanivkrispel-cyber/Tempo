using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Platform.Modules.PlatformAdmin;

namespace Tempo.Worker.Consumers.Tripwire;

/// <summary>
/// The daily 10-studio check (docs/26 section 10.2). EventBridge Scheduler
/// puts a `tripwire.check` message on the work queue once a day; the check
/// itself is <see cref="HourlyBackupTripwire"/>. Without an alarm topic
/// (development) a reached threshold is only logged.
/// </summary>
public sealed class TripwireMessageHandler(ILogger logger, HourlyBackupTripwire tripwire, IOwnerAlert? alert) : IQueueMessageHandler
{
    public async Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        var (outcome, active) = await tripwire.CheckAsync(alert, CancellationToken.None);

        if (outcome == TripwireOutcome.Fired && alert is null)
        {
            logger.Warning(
                "Hourly-backup tripwire reached with {ActiveOrganizations} active studios; no alarm topic in this environment. CorrelationId={CorrelationId}",
                active,
                correlationId);
            return;
        }

        logger.Information(
            "Hourly-backup tripwire check: {Outcome} with {ActiveOrganizations} active studios. CorrelationId={CorrelationId}",
            outcome,
            active,
            correlationId);
    }
}
