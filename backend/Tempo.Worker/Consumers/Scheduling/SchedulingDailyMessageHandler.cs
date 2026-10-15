using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Worker.Consumers.Scheduling;

/// <summary>
/// The daily scheduling job (docs/29 section 11). EventBridge Scheduler puts a `scheduling.daily` message on
/// the work queue once a day; the work itself is <see cref="SchedulingDailyJob"/>.
/// </summary>
public sealed class SchedulingDailyMessageHandler(ILogger logger, SchedulingDailyJob job) : IQueueMessageHandler
{
    public async Task HandleAsync(SQSEvent.SQSMessage record, string correlationId, ILambdaContext context)
    {
        var (sessions, expired) = await job.RunAsync(CancellationToken.None);
        logger.Information(
            "Scheduling daily job: {Sessions} sessions materialized, {ExpiredWaitlist} waitlist places closed. CorrelationId={CorrelationId}",
            sessions,
            expired,
            correlationId);
    }
}
