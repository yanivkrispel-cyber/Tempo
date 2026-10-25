import { Duration, Stack, StackProps } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  IWidget,
  Metric,
  TextWidget,
  TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";
import { NEON_FREE_LIMIT_TRIPWIRE_PERCENT, NEON_USAGE_INTERVAL_HOURS, NEON_USAGE_METRIC } from "../data/database-stack";

export const API_P99_THRESHOLD_MS = 2000;
export const SES_BOUNCE_RATE_THRESHOLD = 0.05;
export const SES_COMPLAINT_RATE_THRESHOLD = 0.001;
/** ADR-0022 tripwire: alert the owners at 70% of any Neon Free plan limit. */
export const NEON_FREE_LIMIT_ALARM_PERCENT = NEON_FREE_LIMIT_TRIPWIRE_PERCENT;
/**
 * The account's Lambda concurrency quota: a new account gets 10, Tempo's
 * development account was raised to 40 (quota case 179192381800130, still
 * open for the 1,000 default). Shown as a line on the dashboard; the
 * `lambda-throttles` alarm fires when it is hit.
 */
export const LAMBDA_CONCURRENCY_QUOTA = 40;

export interface ObservabilityStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly httpApi: HttpApi;
  readonly apiFunction: LambdaFunction;
  readonly workerFunction: LambdaFunction;
  readonly migratorFunction: LambdaFunction;
  readonly workQueue: Queue;
  readonly workDeadLetterQueue: Queue;
}

/**
 * Cross-cutting CloudWatch alarms and the dashboard (LLD sections 25, 34).
 * Queue-level alarms (DLQ depth, oldest-message age) already live on each
 * SecureQueue and are not duplicated here. Development has no alarms
 * (ADR-0012 amendment); its dashboard is the one place to look. The
 * dashboard stays inside the free tier: three dashboards of up to fifty
 * metrics each are free, and this is one of them.
 *
 * Alarm notifications are optional in development (no approved channel
 * configured yet) but the SNS topic + subscription wiring is real and is
 * exactly what production uses once `observability.alarmEmail` is set -
 * see config/environment-config.ts's production-only validation rule.
 */
export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config } = props;

    if (config.observability.alarmsEnabled) {
      this.addAlarms(config, props);
    }

    new Dashboard(this, "Dashboard", {
      dashboardName: resourceName(config, "dashboard"),
      widgets: this.dashboardRows(config, props)
    });

    applyStandardTags(this, config, "observability");
  }

  /**
   * One row per question an operator asks at night: is the API healthy, is
   * Lambda near the concurrency quota, is the queue draining, did the daily
   * jobs and the canary run, how close is Neon to a Free plan limit.
   */
  private dashboardRows(config: TempoEnvironmentConfig, props: ObservabilityStackProps): IWidget[][] {
    const fiveMinutes = Duration.minutes(5);
    const lambdaByName = (metricName: string, functionName: string, label: string): Metric =>
      new Metric({
        namespace: "AWS/Lambda",
        metricName,
        dimensionsMap: { FunctionName: functionName },
        statistic: "Sum",
        period: fiveMinutes,
        label
      });
    const scheduler = (metricName: string): Metric =>
      new Metric({ namespace: "AWS/Scheduler", metricName, statistic: "Sum", period: Duration.hours(1) });

    // The daily jobs are messages the Scheduler puts on the work queue; the
    // worker runs them. The canary and the Neon usage check are functions of
    // their own, named here so this stack does not depend on theirs.
    const jobFunctions = [
      { name: props.workerFunction.functionName, label: "worker (daily jobs)" },
      { name: resourceName(config, "neon-usage"), label: "neon-usage" },
      ...(config.featureFlags.enableDevCanary ? [{ name: resourceName(config, "api-canary"), label: "api-canary" }] : [])
    ];

    return [
      [
        new TextWidget({
          width: 24,
          height: 2,
          markdown:
            `# Tempo ${config.environmentName}\n` +
            "API health, Lambda against its concurrency quota, the work queue, the daily jobs and the canary, Neon. " +
            "Alarms (production only) are listed in ADR-0012; development has none, so this page is where to look."
        })
      ],
      [
        new GraphWidget({
          title: "API Gateway - requests / errors / latency",
          width: 12,
          left: [props.httpApi.metricCount(), props.httpApi.metricServerError(), props.httpApi.metricClientError()],
          right: [props.httpApi.metricLatency({ statistic: "p99" })]
        }),
        new GraphWidget({
          title: "API function - duration p50 / p99 (ms)",
          width: 12,
          left: [
            props.apiFunction.metricDuration({ statistic: "p50", period: fiveMinutes }),
            props.apiFunction.metricDuration({ statistic: "p99", period: fiveMinutes })
          ],
          leftAnnotations: [{ value: API_P99_THRESHOLD_MS, label: "p99 alarm threshold" }]
        })
      ],
      [
        new GraphWidget({
          title: "Lambda - errors / throttles",
          width: 12,
          left: [
            props.apiFunction.metricErrors(),
            props.workerFunction.metricErrors(),
            props.migratorFunction.metricErrors()
          ],
          right: [
            props.apiFunction.metricThrottles(),
            props.workerFunction.metricThrottles(),
            props.migratorFunction.metricThrottles()
          ]
        }),
        new GraphWidget({
          title: `Lambda - concurrent executions vs. the quota (${LAMBDA_CONCURRENCY_QUOTA})`,
          width: 12,
          left: [
            new Metric({
              namespace: "AWS/Lambda",
              metricName: "ConcurrentExecutions",
              statistic: "Maximum",
              period: Duration.minutes(1),
              label: "all functions"
            }),
            props.apiFunction.metricInvocations({ period: fiveMinutes, label: "API invocations" })
          ],
          leftAnnotations: [{ value: LAMBDA_CONCURRENCY_QUOTA, label: "account quota" }]
        })
      ],
      [
        new GraphWidget({
          title: "Work queue - visible / in flight / dead letters",
          width: 12,
          left: [
            props.workQueue.metricApproximateNumberOfMessagesVisible({ label: "visible" }),
            props.workQueue.metricApproximateNumberOfMessagesNotVisible({ label: "in flight" }),
            props.workDeadLetterQueue.metricApproximateNumberOfMessagesVisible({ label: "dead letters" })
          ],
          right: [props.workQueue.metricApproximateAgeOfOldestMessage({ label: "oldest message (s)" })]
        }),
        new GraphWidget({
          title: "Daily jobs and canary - invocations / errors",
          width: 12,
          left: jobFunctions.map((fn) => lambdaByName("Invocations", fn.name, `${fn.label} invocations`)),
          right: jobFunctions.map((fn) => lambdaByName("Errors", fn.name, `${fn.label} errors`))
        })
      ],
      [
        new GraphWidget({
          title: "EventBridge Scheduler - attempts / target errors / dropped (per hour)",
          width: 12,
          left: [scheduler("InvocationAttemptCount")],
          right: [scheduler("TargetErrorCount"), scheduler("InvocationDroppedCount")]
        }),
        new GraphWidget({
          title: "Neon - highest share of a Free plan limit (%)",
          width: 12,
          left: [
            new Metric({
              ...NEON_USAGE_METRIC,
              dimensionsMap: { Environment: config.environmentName },
              statistic: "Maximum",
              period: Duration.hours(NEON_USAGE_INTERVAL_HOURS)
            })
          ],
          leftAnnotations: [{ value: NEON_FREE_LIMIT_ALARM_PERCENT, label: "alarm threshold" }]
        })
      ]
    ];
  }

  /**
   * Six of production's ten alarms (ADR-0012 amendment). The work queue
   * carries two more (DLQ messages visible, oldest message age) and the edge
   * stack the last two (CloudFront 5xx rate, canary failure), because
   * CloudFront's metrics exist only in us-east-1. Every other signal on the
   * ADR-0012 list is watched on the dashboard.
   */
  private addAlarms(config: TempoEnvironmentConfig, props: ObservabilityStackProps): void {
    const alarmAction = this.buildAlarmAction(config);
    const fiveMinutes = Duration.minutes(5);

    // Without a FunctionName dimension Lambda reports these across all
    // functions in the Region, so one alarm covers every function.
    const lambdaErrors = new Alarm(this, "LambdaErrorsAlarm", {
      alarmName: resourceName(config, "lambda-errors"),
      alarmDescription: "A Lambda function in this Region reported errors",
      metric: new Metric({ namespace: "AWS/Lambda", metricName: "Errors", statistic: "Sum", period: fiveMinutes }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    const lambdaThrottles = new Alarm(this, "LambdaThrottlesAlarm", {
      alarmName: resourceName(config, "lambda-throttles"),
      alarmDescription: "A Lambda function in this Region was throttled",
      metric: new Metric({ namespace: "AWS/Lambda", metricName: "Throttles", statistic: "Sum", period: fiveMinutes }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    const apiDuration = new Alarm(this, "ApiDurationP99Alarm", {
      alarmName: resourceName(config, "api-duration-p99"),
      alarmDescription: `API function p99 duration is above ${API_P99_THRESHOLD_MS} ms`,
      metric: props.apiFunction.metricDuration({ period: fiveMinutes, statistic: "p99" }),
      threshold: API_P99_THRESHOLD_MS,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    // ADR-0022: Neon suspends the compute over a Free plan limit, so the
    // owners hear at 70% and move production to the Launch plan. The usage
    // check runs every six hours; a check that fails shows in lambda-errors.
    const neonFreeLimit = new Alarm(this, "NeonFreeLimitAlarm", {
      alarmName: resourceName(config, "neon-free-limit"),
      alarmDescription: `The Neon project used ${NEON_FREE_LIMIT_ALARM_PERCENT}% of a Free plan limit this period`,
      metric: new Metric({
        ...NEON_USAGE_METRIC,
        dimensionsMap: { Environment: config.environmentName },
        statistic: "Maximum",
        period: Duration.hours(NEON_USAGE_INTERVAL_HOURS)
      }),
      threshold: NEON_FREE_LIMIT_ALARM_PERCENT,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    // SES account reputation. AWS reviews an account at a 5% bounce rate or
    // a 0.1% complaint rate; these alarms fire at those points.
    const sesBounce = this.sesReputationAlarm(config, "SesBounceRateAlarm", "ses-bounce-rate", "BounceRate", SES_BOUNCE_RATE_THRESHOLD);
    const sesComplaint = this.sesReputationAlarm(
      config,
      "SesComplaintRateAlarm",
      "ses-complaint-rate",
      "ComplaintRate",
      SES_COMPLAINT_RATE_THRESHOLD
    );

    if (alarmAction) {
      for (const alarm of [lambdaErrors, lambdaThrottles, apiDuration, neonFreeLimit, sesBounce, sesComplaint]) {
        alarm.addAlarmAction(alarmAction);
      }
    }
  }

  private sesReputationAlarm(
    config: TempoEnvironmentConfig,
    id: string,
    name: string,
    metric: "BounceRate" | "ComplaintRate",
    threshold: number
  ): Alarm {
    return new Alarm(this, id, {
      alarmName: resourceName(config, name),
      alarmDescription: `SES account ${metric} reached ${threshold * 100}%`,
      metric: new Metric({
        namespace: "AWS/SES",
        metricName: `Reputation.${metric}`,
        statistic: "Maximum",
        period: Duration.hours(1)
      }),
      threshold,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });
  }

  private buildAlarmAction(config: TempoEnvironmentConfig): SnsAction | undefined {
    if (!config.observability.alarmNotificationsEnabled || !config.observability.alarmEmail) {
      return undefined;
    }

    const topic = new Topic(this, "AlarmTopic", {
      topicName: resourceName(config, "alarms"),
      enforceSSL: true
    });
    topic.addSubscription(new EmailSubscription(config.observability.alarmEmail));

    return new SnsAction(topic);
  }
}
