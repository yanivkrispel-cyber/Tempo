import { Duration, Stack, StackProps } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  Metric,
  TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { DatabaseCluster } from "aws-cdk-lib/aws-rds";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export const API_P99_THRESHOLD_MS = 2000;
export const SES_BOUNCE_RATE_THRESHOLD = 0.05;
export const SES_COMPLAINT_RATE_THRESHOLD = 0.001;

export interface ObservabilityStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly httpApi: HttpApi;
  readonly apiFunction: LambdaFunction;
  readonly workerFunction: LambdaFunction;
  readonly migratorFunction: LambdaFunction;
  readonly cluster: DatabaseCluster;
}

/**
 * Cross-cutting CloudWatch alarms and a starter dashboard (LLD sections 25,
 * 34). Queue-level alarms (DLQ depth, oldest-message age) already live on
 * each SecureQueue and are not duplicated here. Development has no alarms
 * (ADR-0012 amendment).
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
      widgets: [
        [
          new GraphWidget({
            title: "API Gateway - requests / errors / latency",
            left: [props.httpApi.metricCount(), props.httpApi.metricServerError(), props.httpApi.metricClientError()],
            right: [props.httpApi.metricLatency({ statistic: "p99" })]
          })
        ],
        [
          new GraphWidget({
            title: "Lambda - errors / throttles",
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
          })
        ],
        [
          new GraphWidget({
            title: "Aurora - connections / capacity",
            left: [props.cluster.metricDatabaseConnections()],
            right: [props.cluster.metric("ServerlessDatabaseCapacity", { statistic: "Maximum" })]
          })
        ]
      ]
    });

    applyStandardTags(this, config, "observability");
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

    // Aurora capacity until step 7 replaces the database with the one
    // ADR-0022 decides. On Aurora DSQL this becomes a DPU spike alarm.
    const databaseCapacity = new Alarm(this, "DatabaseCapacityAlarm", {
      alarmName: resourceName(config, "database-capacity"),
      alarmDescription: "Database capacity is near its configured maximum",
      metric: props.cluster.metric("ServerlessDatabaseCapacity", { period: fiveMinutes, statistic: "Maximum" }),
      threshold: config.aurora.maxAcu * 0.9,
      evaluationPeriods: 3,
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
      for (const alarm of [lambdaErrors, lambdaThrottles, apiDuration, databaseCapacity, sesBounce, sesComplaint]) {
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
      topicName: resourceName(config, "alarms")
    });
    topic.addSubscription(new EmailSubscription(config.observability.alarmEmail));

    return new SnsAction(topic);
  }
}
