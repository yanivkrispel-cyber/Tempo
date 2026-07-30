import { Stack, StackProps } from "aws-cdk-lib";
import { IEventBus, Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { TempoFunction } from "../constructs/lambda-defaults";
import { SecureQueue } from "../constructs/secure-queue";
import { applyStandardTags } from "../constructs/tagging";

export interface MessagingStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly eventBus: IEventBus;
}

/**
 * SQS queues for the Phase 0 foundation (ADR-0008, LLD section 15), plus the
 * single Lambda worker that consumes them. Only queues with a real consumer
 * in this slice are created: `outbox-publish` (the transactional outbox
 * pattern's delivery queue) and `smoke-test` (used by the deployment smoke
 * test and the EventBridge/Scheduler validation targets). The remaining
 * LLD-listed queues (webhooks, notifications, files, billing, imports,
 * exports) are deferred until their first real consumer exists.
 *
 * The worker is not VPC-attached in this phase - its handlers are skeletons
 * with no Aurora I/O yet (see networking/network-stack.ts for the fuller
 * networking decision). It must attach to `lambdaDbSecurityGroup` in the
 * private isolated subnets once real outbox-claiming logic lands.
 */
export class MessagingStack extends Stack {
  public readonly outboxPublishQueue: SecureQueue;
  public readonly smokeTestQueue: SecureQueue;
  public readonly workerFunction: TempoFunction;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.outboxPublishQueue = new SecureQueue(this, "OutboxPublishQueue", config, {
      queueName: resourceName(config, "outbox-publish"),
      component: "messaging-outbox",
      consumerTimeoutSeconds: config.lambda.workerTimeoutSeconds
    });

    this.smokeTestQueue = new SecureQueue(this, "SmokeTestQueue", config, {
      queueName: resourceName(config, "smoke-test"),
      component: "messaging-smoke-test",
      consumerTimeoutSeconds: config.lambda.workerTimeoutSeconds
    });

    this.workerFunction = new TempoFunction(this, "OutboxWorkerFunction", config, {
      functionName: resourceName(config, "worker-outbox"),
      component: "worker-outbox",
      description: "Tempo.Worker - consumes outbox-publish and smoke-test SQS messages",
      code: resolveDotNetLambdaCode("Tempo.Worker"),
      handler: "Tempo.Worker::Tempo.Worker.Function::FunctionHandler",
      memoryMb: config.lambda.workerMemoryMb,
      timeoutSeconds: config.lambda.workerTimeoutSeconds,
      reservedConcurrentExecutions: config.lambda.workerReservedConcurrency
    });

    this.workerFunction.function.addEventSource(
      new SqsEventSource(this.outboxPublishQueue.queue, { reportBatchItemFailures: true, batchSize: 10 })
    );
    this.workerFunction.function.addEventSource(
      new SqsEventSource(this.smokeTestQueue.queue, { reportBatchItemFailures: true, batchSize: 10 })
    );

    // Lives here (not EventsStack) so the queue's resource policy - which a
    // cross-stack SqsQueue target conditions on this rule's ARN - stays in
    // the same stack as the queue. See events-stack.ts for why.
    new Rule(this, "SmokeTestRule", {
      eventBus: props.eventBus,
      ruleName: resourceName(config, "smoke-test-rule"),
      description: "Technical validation only: routes tempo.smoke-test.requested to the smoke-test queue",
      eventPattern: {
        source: ["tempo.foundation"],
        detailType: ["tempo.smoke-test.requested"]
      },
      targets: [new SqsQueue(this.smokeTestQueue.queue)]
    });

    applyStandardTags(this, config, "messaging");
  }
}
