import { Duration } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { TempoEnvironmentConfig } from "../../config/environment-config";
import { applyStandardTags } from "./tagging";

export interface SecureQueueProps {
  /** Physical queue name, e.g. "tempo-dev-outbox-publish". The DLQ is named "<queueName>-dlq". */
  readonly queueName: string;
  readonly component: string;
  /** Timeout of the Lambda consumer(s) processing this queue, in seconds. */
  readonly consumerTimeoutSeconds: number;
  /** Message retention, in days. Defaults to 14 (the SQS maximum). */
  readonly retentionDays?: number;
  /** Redrive attempts before a message moves to the DLQ. Defaults to 5. */
  readonly maxReceiveCount?: number;
  readonly fifo?: boolean;
}

/**
 * Standard SQS queue + DLQ pair: encryption, long polling, a visibility
 * timeout safely larger than the consumer timeout, explicit retention, and
 * alarms on DLQ depth and oldest-message age (LLD section 34.2 / 15, ADR-0008).
 */
export class SecureQueue extends Construct {
  public readonly queue: Queue;
  public readonly deadLetterQueue: Queue;

  constructor(scope: Construct, id: string, config: TempoEnvironmentConfig, props: SecureQueueProps) {
    super(scope, id);

    const maxReceiveCount = props.maxReceiveCount ?? 5;
    // AWS-recommended minimum: visibility timeout >= 6x the consumer function
    // timeout, so a message survives retries without becoming visible again
    // mid-processing.
    const visibilityTimeout = Duration.seconds(props.consumerTimeoutSeconds * 6);

    this.deadLetterQueue = new Queue(this, "DeadLetterQueue", {
      queueName: `${props.queueName}-dlq`,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      fifo: props.fifo
    });

    this.queue = new Queue(this, "Queue", {
      queueName: props.queueName,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(props.retentionDays ?? 14),
      visibilityTimeout,
      receiveMessageWaitTime: Duration.seconds(20),
      fifo: props.fifo,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount
      }
    });

    new Alarm(this, "DeadLetterMessagesAlarm", {
      alarmName: `${props.queueName}-dlq-messages`,
      alarmDescription: `One or more messages landed in the DLQ for ${props.queueName}`,
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    new Alarm(this, "OldestMessageAgeAlarm", {
      alarmName: `${props.queueName}-oldest-message-age`,
      alarmDescription: `Oldest message in ${props.queueName} is not being processed in time`,
      metric: this.queue.metricApproximateAgeOfOldestMessage({
        period: Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: visibilityTimeout.toSeconds() * 2,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    applyStandardTags(this, config, props.component);
  }
}
