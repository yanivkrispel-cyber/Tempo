using System.Diagnostics.CodeAnalysis;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Serilog;
using Serilog.Formatting.Compact;
using Tempo.Worker.Consumers;
using Tempo.Worker.Consumers.Outbox;
using Tempo.Worker.Consumers.SmokeTest;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Tempo.Worker;

/// <summary>
/// tempo-{env}-worker-outbox. A thin Lambda entry point (LLD section 8) -
/// all behavior lives in Consumers/SqsMessageDispatcher and its per-queue
/// handlers so they stay unit-testable without a Lambda runtime.
/// </summary>
[SuppressMessage("Design", "CA1716", Justification = "Class name is the deployed Lambda handler; infrastructure/lib/async/messaging-stack.ts references 'Tempo.Worker.Function::FunctionHandler' by name.")]
public class Function
{
    private static readonly ILogger Logger = new LoggerConfiguration()
        .Enrich.FromLogContext()
        .Enrich.WithProperty("service", "tempo-worker-outbox")
        .WriteTo.Console(new RenderedCompactJsonFormatter())
        .CreateLogger();

    private readonly SqsMessageDispatcher _dispatcher =
        new(Logger, new OutboxMessageHandler(Logger), new SmokeTestMessageHandler(Logger));

    public Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
        => _dispatcher.HandleAsync(sqsEvent, context);
}
