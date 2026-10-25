import * as path from "node:path";
import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { Architecture, Code, Function as LambdaFunction, LoggingFormat, Runtime } from "aws-cdk-lib/aws-lambda";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { createLogGroup } from "../constructs/log-group-defaults";
import { applyStandardTags } from "../constructs/tagging";
import { smokeTestParameterPath } from "../identity/identity-stack";

/** Minutes between health checks (no database). */
export const DEV_CANARY_HEALTH_MINUTES = 5;
/**
 * Minutes between deep checks (sign-in and one tenant read, so Neon wakes up).
 * About 24 wake-ups a day keep the Free plan's 100 CU-hours safe: usage was
 * 1.6% of the highest Free limit on 2026-10-15.
 */
export const DEV_CANARY_DEEP_MINUTES = 60;

/** The canary's SNS topic; the Neon usage check in the Database stack emails through it too (#97). */
export function devCanaryTopicName(config: TempoEnvironmentConfig): string {
  return resourceName(config, "api-canary");
}

export interface DevCanaryStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly httpApi: HttpApi;
  readonly userPool: UserPool;
  readonly clientWebClient: UserPoolClient;
}

/**
 * The development canary (Wave Q, Q10; ADR-0025). Production has its own
 * canary in the edge stack, behind CloudFront. This one calls the API directly,
 * because development runs without the edge. There is no CloudWatch alarm:
 * development keeps zero alarms (the ten free ones are pooled across the
 * Organization; alarm-budget.test.ts). The function keeps the last three
 * results of each check in an SSM parameter and emails the owner through SNS
 * when two of three fail, and again on recovery. No custom metrics.
 */
export class DevCanaryStack extends Stack {
  constructor(scope: Construct, id: string, props: DevCanaryStackProps) {
    super(scope, id, props);
    const { config } = props;
    const functionName = resourceName(config, "api-canary");
    const statePrefix = `/tempo/${config.environmentName}/canary`;
    const smokePath = smokeTestParameterPath(config);

    const topic = new Topic(this, "CanaryTopic", { topicName: devCanaryTopicName(config), enforceSSL: true });
    topic.addSubscription(new EmailSubscription(config.cost.alertEmail));

    const logGroup = createLogGroup(this, "CanaryLogGroup", config, { logGroupName: `/aws/lambda/${functionName}` });
    const canary = new LambdaFunction(this, "CanaryFunction", {
      functionName,
      description: "Development canary: health every 5 minutes, sign-in and a tenant read every hour (Q10)",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      // A failed check is recorded, not retried: the next one is minutes away.
      retryAttempts: 0,
      loggingFormat: LoggingFormat.JSON,
      logGroup,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, "../../lambda/canary"), { exclude: ["*.d.ts"] }),
      environment: {
        API_URL: props.httpApi.apiEndpoint,
        USER_POOL_ID: props.userPool.userPoolId,
        CLIENT_ID: props.clientWebClient.userPoolClientId,
        SMOKE_PARAMETER_PATH: smokePath,
        STATE_PARAMETER_PREFIX: statePrefix,
        TOPIC_ARN: topic.topicArn,
        LOG_GROUP: logGroup.logGroupName
      }
    });

    // One state parameter per check: the 5-minute and the hourly run can overlap.
    for (const check of ["health", "deep", "selftest"]) {
      const state = new StringParameter(this, `${check[0].toUpperCase()}${check.slice(1)}State`, {
        parameterName: `${statePrefix}/${check}`,
        description: `Last three results of the ${check} check (Q10). Written by the canary.`,
        stringValue: JSON.stringify({ results: [], alerting: false })
      });
      state.grantRead(canary);
      state.grantWrite(canary);
    }

    StringParameter.fromStringParameterName(this, "SmokeEmail", `${smokePath}/email`).grantRead(canary);
    StringParameter.fromSecureStringParameterAttributes(this, "SmokePassword", {
      parameterName: `${smokePath}/password`
    }).grantRead(canary);
    props.userPool.grant(canary, "cognito-idp:AdminInitiateAuth");
    topic.grantPublish(canary);

    for (const [check, minutes] of [
      ["health", DEV_CANARY_HEALTH_MINUTES],
      ["deep", DEV_CANARY_DEEP_MINUTES]
    ] as const) {
      new Schedule(this, `${check === "health" ? "Health" : "Deep"}Schedule`, {
        scheduleName: `${functionName}-${check}`,
        description: `Runs the development canary's ${check} check (Q10)`,
        schedule: ScheduleExpression.rate(Duration.minutes(minutes)),
        target: new LambdaInvoke(canary, { input: ScheduleTargetInput.fromObject({ mode: check }), retryAttempts: 0 })
      });
    }

    applyStandardTags(this, config, "observability");
  }
}
