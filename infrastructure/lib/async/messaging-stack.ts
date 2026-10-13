import { Stack, StackProps } from "aws-cdk-lib";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { TempoFunction } from "../constructs/lambda-defaults";
import { SecureQueue } from "../constructs/secure-queue";
import { applyStandardTags } from "../constructs/tagging";

export interface MessagingStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * The single SQS work queue and its DLQ (ADR-0008 amendment, LLD section
 * 15), plus the Lambda worker that consumes it. Every message carries a
 * `MessageType` attribute and the worker routes on it, so new kinds of work
 * add a handler, not a queue. Every SQS trigger long-polls even when idle and
 * those receives count toward SQS's free requests, so a separate queue is
 * added only when a job needs its own backpressure or concurrency limit.
 *
 * The worker is not VPC-attached: its handlers are skeletons with no
 * database I/O yet.
 */
export class MessagingStack extends Stack {
  public readonly workQueue: SecureQueue;
  public readonly workerFunction: TempoFunction;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.workQueue = new SecureQueue(this, "WorkQueue", config, {
      queueName: resourceName(config, "work"),
      component: "messaging-work",
      consumerTimeoutSeconds: config.lambda.workerTimeoutSeconds
    });

    this.workerFunction = new TempoFunction(this, "OutboxWorkerFunction", config, {
      functionName: resourceName(config, "worker-outbox"),
      component: "worker-outbox",
      description: "Tempo.Worker - consumes the work queue, routing by MessageType",
      code: resolveDotNetLambdaCode("Tempo.Worker"),
      handler: "Tempo.Worker::Tempo.Worker.Function::FunctionHandler",
      memoryMb: config.lambda.workerMemoryMb,
      timeoutSeconds: config.lambda.workerTimeoutSeconds,
      reservedConcurrentExecutions: config.lambda.workerReservedConcurrency
    });

    this.workerFunction.function.addEventSource(
      new SqsEventSource(this.workQueue.queue, { reportBatchItemFailures: true, batchSize: 10 })
    );

    applyStandardTags(this, config, "messaging");
  }
}
