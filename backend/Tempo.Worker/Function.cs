using System.Diagnostics.CodeAnalysis;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Serilog.Formatting.Compact;
using Tempo.Worker.Consumers;
using Tempo.Worker.Consumers.Outbox;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.PlatformAdmin;
using Tempo.Worker.Consumers.SmokeTest;
using Tempo.Platform.Modules.Retention.Application;
using Tempo.Platform.Modules.Scheduling.Application;
using Tempo.Platform.Modules.Notifications.Application;
using Tempo.Platform.Modules.Notifications.Infrastructure;
using Tempo.Worker.Consumers.Notifications;
using Tempo.Worker.Consumers.Retention;
using Tempo.Worker.Consumers.Scheduling;
using Tempo.Worker.Consumers.Tripwire;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Tempo.Worker;

/// <summary>
/// tempo-{env}-worker-outbox. A thin Lambda entry point (LLD section 8) for
/// the single work queue - all behavior lives in Consumers/SqsMessageDispatcher
/// and its per-message-type handlers so they stay unit-testable without a
/// Lambda runtime.
/// </summary>
[SuppressMessage("Design", "CA1716", Justification = "Class name is the deployed Lambda handler; infrastructure/lib/async/messaging-stack.ts references 'Tempo.Worker.Function::FunctionHandler' by name.")]
public class Function
{
    private static readonly ILogger Logger = new LoggerConfiguration()
        .Enrich.FromLogContext()
        .Enrich.WithProperty("service", "tempo-worker-outbox")
        .WriteTo.Console(new RenderedCompactJsonFormatter())
        .CreateLogger();

    // Built on first use: only the tripwire and scheduling messages touch the database.
    // DATABASE_HOST, DATABASE_NAME and DATABASE_PLATFORM_PASSWORD_PARAMETER
    // come from the stack; ALARM_TOPIC_ARN only where alarms email the owner.
    private static readonly ConfiguredDataSourceProvider DataSources = new(Environment.GetEnvironmentVariable);

    // VAPID_PUBLIC_KEY_PARAMETER, VAPID_PRIVATE_KEY_PARAMETER and VAPID_SUBJECT come from the stack; until a person
    // writes the keys, push deliveries are skipped as channel_unavailable (docs/30 section 4.3).
    private static readonly VapidKeySource VapidKeys = new(Environment.GetEnvironmentVariable, needsPrivateKey: true);

    private static readonly HttpClient PushHttp = new() { Timeout = TimeSpan.FromSeconds(10) };

    private readonly SqsMessageDispatcher _dispatcher = new(
        Logger,
        new Dictionary<string, IQueueMessageHandler>(StringComparer.Ordinal)
        {
            [MessageTypes.OutboxPublish] = new OutboxMessageHandler(Logger),
            [MessageTypes.SmokeTest] = new SmokeTestMessageHandler(Logger),
            [MessageTypes.TripwireCheck] = new TripwireMessageHandler(
                Logger,
                new HourlyBackupTripwire(DataSources),
                Environment.GetEnvironmentVariable("ALARM_TOPIC_ARN") is { Length: > 0 } topic ? new SnsOwnerAlert(topic) : null),
            [MessageTypes.SchedulingDaily] = new SchedulingDailyMessageHandler(Logger, new SchedulingDailyJob(DataSources, TimeProvider.System)),
            [MessageTypes.RetentionDaily] = new RetentionMessageHandler(Logger, new RetentionJob(DataSources, TimeProvider.System, RetentionPolicy.Default)),
            [MessageTypes.NotificationsDeliver] = new NotificationDeliveryMessageHandler(Logger, new NotificationDeliveryJob(DataSources, TimeProvider.System, PushSenderAsync)),
            [MessageTypes.NotificationsReminders] = new ReminderMessageHandler(
                Logger,
                new ReminderJob(DataSources, TimeProvider.System),
                new NotificationDeliveryJob(DataSources, TimeProvider.System, PushSenderAsync))
        });

    public Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
        => _dispatcher.HandleAsync(sqsEvent, context);

    private static async Task<IPushSender?> PushSenderAsync(CancellationToken cancellationToken) =>
        await VapidKeys.GetAsync(cancellationToken) is { } keys ? new WebPushSender(PushHttp, keys, TimeProvider.System) : null;
}
