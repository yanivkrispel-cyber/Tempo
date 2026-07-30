import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { SqsSendMessage } from "aws-cdk-lib/aws-scheduler-targets";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export interface SchedulerStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly smokeTestQueue: IQueue;
}

/**
 * EventBridge Scheduler foundation (LLD section 18). The schedule enqueues a
 * durable message onto the smoke-test queue rather than executing any
 * business logic directly, and is disabled by default so it never runs
 * unattended or incurs production-impacting cost - enable it manually to
 * validate the Scheduler -> SQS path. Real recurring jobs (reconciliation,
 * scheduled exports, etc.) are added as their own schedules in a future
 * phase, each targeting a durable queue the same way.
 */
export class SchedulerStack extends Stack {
  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);
    const { config } = props;

    new Schedule(this, "SmokeTestSchedule", {
      scheduleName: resourceName(config, "smoke-test-schedule"),
      description: "Disabled by default. Enqueues a durable smoke-test message to validate Scheduler -> SQS.",
      schedule: ScheduleExpression.rate(Duration.hours(1)),
      enabled: false,
      target: new SqsSendMessage(props.smokeTestQueue, {
        input: ScheduleTargetInput.fromText("tempo-scheduler-smoke-test")
      })
    });

    applyStandardTags(this, config, "scheduler");
  }
}
