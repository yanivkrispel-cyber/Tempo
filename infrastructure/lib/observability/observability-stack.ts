import { Duration, Stack, StackProps } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
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
 * each SecureQueue and are not duplicated here.
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

  private addAlarms(config: TempoEnvironmentConfig, props: ObservabilityStackProps): void {
    const alarmAction = this.buildAlarmAction(config);

    const api5xxAlarm = new Alarm(this, "Api5xxAlarm", {
      alarmName: resourceName(config, "api-5xx"),
      alarmDescription: "API Gateway is returning server errors",
      metric: props.httpApi.metricServerError({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    const apiLatencyAlarm = new Alarm(this, "ApiLatencyAlarm", {
      alarmName: resourceName(config, "api-latency-p99"),
      alarmDescription: "API Gateway p99 latency is elevated",
      metric: props.httpApi.metricLatency({ period: Duration.minutes(5), statistic: "p99" }),
      threshold: 2000,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    const functionAlarms = [
      this.functionAlarms(config, "Api", props.apiFunction, config.lambda.apiTimeoutSeconds),
      this.functionAlarms(config, "Worker", props.workerFunction, config.lambda.workerTimeoutSeconds),
      this.functionAlarms(config, "Migrator", props.migratorFunction, 900)
    ].flat();

    const auroraConnectionsAlarm = new Alarm(this, "AuroraConnectionsAlarm", {
      alarmName: resourceName(config, "aurora-connections"),
      alarmDescription: "Aurora connection count is unexpectedly high",
      metric: props.cluster.metricDatabaseConnections({ period: Duration.minutes(5), statistic: "Maximum" }),
      threshold: 200,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    const auroraCapacityAlarm = new Alarm(this, "AuroraCapacityAlarm", {
      alarmName: resourceName(config, "aurora-capacity-near-max"),
      alarmDescription: "Aurora Serverless v2 capacity is near its configured maximum ACU",
      metric: props.cluster.metric("ServerlessDatabaseCapacity", { period: Duration.minutes(5), statistic: "Maximum" }),
      threshold: config.aurora.maxAcu * 0.9,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    const auroraDeadlocksAlarm = new Alarm(this, "AuroraDeadlocksAlarm", {
      alarmName: resourceName(config, "aurora-deadlocks"),
      alarmDescription: "Aurora is reporting deadlocks",
      metric: props.cluster.metricDeadlocks({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    for (const alarm of [
      api5xxAlarm,
      apiLatencyAlarm,
      ...functionAlarms,
      auroraConnectionsAlarm,
      auroraCapacityAlarm,
      auroraDeadlocksAlarm
    ]) {
      if (alarmAction) {
        alarm.addAlarmAction(alarmAction);
      }
    }
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

  private functionAlarms(
    config: TempoEnvironmentConfig,
    name: string,
    fn: LambdaFunction,
    timeoutSeconds: number
  ): Alarm[] {
    return [
      new Alarm(this, `${name}ErrorsAlarm`, {
        alarmName: resourceName(config, `${name.toLowerCase()}-errors`),
        alarmDescription: `${name} Lambda is reporting errors`,
        metric: fn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING
      }),
      new Alarm(this, `${name}ThrottlesAlarm`, {
        alarmName: resourceName(config, `${name.toLowerCase()}-throttles`),
        alarmDescription: `${name} Lambda is being throttled`,
        metric: fn.metricThrottles({ period: Duration.minutes(5), statistic: "Sum" }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING
      }),
      new Alarm(this, `${name}DurationAlarm`, {
        alarmName: resourceName(config, `${name.toLowerCase()}-duration-near-timeout`),
        alarmDescription: `${name} Lambda duration is approaching its configured timeout`,
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: "Maximum" }),
        threshold: Duration.seconds(timeoutSeconds * 0.8).toMilliseconds(),
        evaluationPeriods: 3,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING
      })
    ];
  }
}
