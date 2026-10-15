import { Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { TempoFunction } from "../constructs/lambda-defaults";
import { SecureQueue } from "../constructs/secure-queue";
import { applyStandardTags } from "../constructs/tagging";
import { databaseParameterName } from "../data/database-stack";

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
 * The worker reaches Neon through the pooled endpoint without a VPC
 * (ADR-0022), as `tempo_platform`, for the one job that needs the database:
 * the daily 10-studio tripwire (docs/26 section 10.2). EventBridge Scheduler
 * sends that message through its universal `sqs:sendMessage` target, the one
 * Scheduler target that can set the `MessageType` attribute. Where alarms
 * email the owner, the worker may publish to the existing alarm topic, named
 * here rather than imported so this stack does not depend on Observability.
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
      reservedConcurrentExecutions: config.lambda.workerReservedConcurrency,
      environment: this.tripwireEnvironment(config)
    });

    this.workerFunction.function.addEventSource(
      new SqsEventSource(this.workQueue.queue, { reportBatchItemFailures: true, batchSize: 10 })
    );

    this.addTripwireSchedule(config);

    applyStandardTags(this, config, "messaging");
  }

  /** Database and alarm settings for the tripwire; grants follow once the function exists. */
  private tripwireEnvironment(config: TempoEnvironmentConfig): Record<string, string> {
    const environment: Record<string, string> = {};
    if (config.neon.pooledHost !== undefined && config.neon.databaseName !== undefined) {
      environment.DATABASE_HOST = config.neon.pooledHost;
      environment.DATABASE_NAME = config.neon.databaseName;
      environment.DATABASE_PLATFORM_PASSWORD_PARAMETER = databaseParameterName(config, "platformPassword");
    }

    if (config.observability.alarmNotificationsEnabled) {
      environment.ALARM_TOPIC_ARN = this.alarmTopicArn(config);
    }

    return environment;
  }

  private addTripwireSchedule(config: TempoEnvironmentConfig): void {
    const worker = this.workerFunction.function;
    if (config.neon.pooledHost !== undefined) {
      StringParameter.fromSecureStringParameterAttributes(this, "PlatformPasswordParameter", {
        parameterName: databaseParameterName(config, "platformPassword")
      }).grantRead(worker);
    }

    if (config.observability.alarmNotificationsEnabled) {
      worker.addToRolePolicy(new PolicyStatement({ actions: ["sns:Publish"], resources: [this.alarmTopicArn(config)] }));
    }

    const role = new Role(this, "TripwireScheduleRole", {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": config.accountId } }
      }),
      description: "Lets EventBridge Scheduler put the daily tripwire message on the work queue"
    });
    this.workQueue.queue.grantSendMessages(role);

    new CfnSchedule(this, "TripwireSchedule", {
      name: resourceName(config, "tripwire"),
      description: "Daily 10-studio check (docs/26 section 10.2, ADR-0021)",
      scheduleExpression: "cron(0 6 * * ? *)",
      scheduleExpressionTimezone: "Asia/Jerusalem",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: "arn:aws:scheduler:::aws-sdk:sqs:sendMessage",
        roleArn: role.roleArn,
        input: Stack.of(this).toJsonString({
          QueueUrl: this.workQueue.queue.queueUrl,
          MessageBody: "{}",
          MessageAttributes: { MessageType: { DataType: "String", StringValue: "tripwire.check" } }
        }),
        retryPolicy: { maximumRetryAttempts: 0 }
      }
    });

    // The daily scheduling job (docs/29 section 11): one more day of sessions, closed waitlists.
    // A second schedule because each one sets a single MessageType; inside the free tier, $0.
    new CfnSchedule(this, "SchedulingDailySchedule", {
      name: resourceName(config, "scheduling-daily"),
      description: "Daily session horizon and closed waitlists (docs/29 section 11)",
      scheduleExpression: "cron(15 3 * * ? *)",
      scheduleExpressionTimezone: "Asia/Jerusalem",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: "arn:aws:scheduler:::aws-sdk:sqs:sendMessage",
        roleArn: role.roleArn,
        input: Stack.of(this).toJsonString({
          QueueUrl: this.workQueue.queue.queueUrl,
          MessageBody: "{}",
          MessageAttributes: { MessageType: { DataType: "String", StringValue: "scheduling.daily" } }
        }),
        retryPolicy: { maximumRetryAttempts: 1 }
      }
    });
  }

  private alarmTopicArn(config: TempoEnvironmentConfig): string {
    return `arn:aws:sns:${config.region}:${config.accountId}:${resourceName(config, "alarms")}`;
  }
}
