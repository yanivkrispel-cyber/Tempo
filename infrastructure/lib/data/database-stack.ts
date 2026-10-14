import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Function as LambdaFunction, LoggingFormat, Runtime } from "aws-cdk-lib/aws-lambda";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { IStringParameter, StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { TempoFunction } from "../constructs/lambda-defaults";
import { createLogGroup } from "../constructs/log-group-defaults";
import { applyStandardTags } from "../constructs/tagging";

export interface DatabaseStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/** SSM SecureString parameters under /tempo/<env>/db/ that a person writes (ADR-0022). */
export const DATABASE_PARAMETERS = {
  /** The Neon owner role's postgresql:// URL on the direct (not -pooler) endpoint. */
  ownerUrl: "neon-connection-string",
  /** Password of `tempo_app`, the least-privileged runtime role. Letters and digits only. */
  applicationPassword: "app-password",
  /** Password of `tempo_platform`, the operator console's role (ADR-0023). Letters and digits only. */
  platformPassword: "platform-password",
  /** Password of `tempo_migrator`, the schema-owning role. Letters and digits only. */
  migratorPassword: "migrator-password"
} as const;

/** SSM SecureString holding a Neon API key that can read the environment's project. */
export function neonApiKeyParameterName(config: TempoEnvironmentConfig): string {
  return `/tempo/${config.environmentName}/neon/api-key`;
}

/**
 * The usage check's metric: the highest share, in percent, of any Neon Free
 * plan limit used in the current billing period. The observability stack
 * alarms on it in production.
 */
export const NEON_USAGE_METRIC = { namespace: "Tempo/Database", metricName: "NeonFreeLimitPercent" } as const;
export const NEON_USAGE_INTERVAL_HOURS = 6;

/**
 * Neon Free plan limits per project, verified on neon.com/pricing on
 * 2026-10-14 (ADR-0022). Over any of them Neon suspends the compute until the
 * next billing period.
 */
export const NEON_FREE_LIMITS = {
  computeSeconds: 100 * 3600,
  storageBytes: 1024 ** 3,
  egressBytes: 5 * 1024 ** 3
} as const;

export function databaseParameterName(config: TempoEnvironmentConfig, key: keyof typeof DATABASE_PARAMETERS): string {
  return `/tempo/${config.environmentName}/db/${DATABASE_PARAMETERS[key]}`;
}

/**
 * The database is Neon serverless Postgres, outside CloudFormation (ADR-0022).
 * This stack holds only Tempo.DatabaseMigrator, which reaches Neon over its
 * public TLS endpoint without a VPC.
 *
 * Connection details are SSM SecureString parameters on the AWS managed
 * `aws/ssm` key. CloudFormation cannot create SecureString values, and the
 * values must never pass through CDK, so a person writes them (see
 * infrastructure/README.md, "Database credentials"). The function gets read
 * access to exactly these four parameters; the AWS managed key needs no
 * kms:Decrypt grant.
 *
 * Database identities (LLD section 12; docs/26 section 7.2): the Neon owner
 * bootstraps the `tempo_migrator`, `tempo_app` and `tempo_platform` roles
 * with the stored passwords on every
 * run (see backend/Tempo.DatabaseMigrator/BootstrapRoles.cs), and DbUp then
 * migrates as `tempo_migrator`.
 */
export class DatabaseStack extends Stack {
  public readonly migratorFunction: TempoFunction;
  public readonly usageCheckFunction: LambdaFunction;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);
    const { config } = props;

    const parameter = (key: keyof typeof DATABASE_PARAMETERS): IStringParameter =>
      StringParameter.fromSecureStringParameterAttributes(this, `${key}Parameter`, {
        parameterName: databaseParameterName(config, key)
      });
    const ownerUrl = parameter("ownerUrl");
    const applicationPassword = parameter("applicationPassword");
    const platformPassword = parameter("platformPassword");
    const migratorPassword = parameter("migratorPassword");

    this.migratorFunction = new TempoFunction(this, "MigratorFunction", config, {
      functionName: resourceName(config, "database-migrator"),
      component: "database-migrator",
      description:
        "Tempo.DatabaseMigrator - deployment-only. Not exposed through API Gateway; invocation is restricted to the deployment role.",
      code: resolveDotNetLambdaCode("Tempo.DatabaseMigrator"),
      handler: "Tempo.DatabaseMigrator::Tempo.DatabaseMigrator.Function::FunctionHandler",
      memoryMb: config.lambda.workerMemoryMb,
      // Migrations can legitimately take longer than a typical worker invocation.
      timeoutSeconds: 900,
      dataClassification: "Confidential",
      environment: {
        OWNER_URL_PARAMETER: ownerUrl.parameterName,
        APPLICATION_PASSWORD_PARAMETER: applicationPassword.parameterName,
        PLATFORM_PASSWORD_PARAMETER: platformPassword.parameterName,
        MIGRATOR_PASSWORD_PARAMETER: migratorPassword.parameterName
      }
    });

    for (const p of [ownerUrl, applicationPassword, platformPassword, migratorPassword]) {
      p.grantRead(this.migratorFunction.function);
    }

    this.usageCheckFunction = this.addUsageCheck(config);

    applyStandardTags(this, config, "database", "Confidential");
  }

  /**
   * Neon's metrics are not in CloudWatch, and its usage is outside the AWS
   * Budget (ADR-0021 amendment). Every six hours EventBridge Scheduler runs a
   * small function that reads the project's current-period usage from the
   * Neon API (the project endpoint works on the Free plan; the consumption
   * history API does not) and publishes the highest share of a Free limit as
   * one custom metric. A failed read throws, so it shows in the Lambda
   * errors alarm. Development runs it too, without an alarm.
   */
  private addUsageCheck(config: TempoEnvironmentConfig): LambdaFunction {
    const functionName = resourceName(config, "neon-usage");
    const apiKey = StringParameter.fromSecureStringParameterAttributes(this, "NeonApiKeyParameter", {
      parameterName: neonApiKeyParameterName(config)
    });

    const fn = new LambdaFunction(this, "NeonUsageFunction", {
      functionName,
      description: "Publishes the share of the Neon Free plan limits used this period (ADR-0022)",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(30),
      // The next run is six hours away; a failure is reported, not retried.
      retryAttempts: 0,
      loggingFormat: LoggingFormat.JSON,
      logGroup: createLogGroup(this, "NeonUsageLogGroup", config, { logGroupName: `/aws/lambda/${functionName}` }),
      environment: {
        NEON_PROJECT_ID: config.neon.projectId,
        API_KEY_PARAMETER: apiKey.parameterName,
        ENVIRONMENT: config.environmentName,
        LIMIT_COMPUTE_SECONDS: String(NEON_FREE_LIMITS.computeSeconds),
        LIMIT_STORAGE_BYTES: String(NEON_FREE_LIMITS.storageBytes),
        LIMIT_EGRESS_BYTES: String(NEON_FREE_LIMITS.egressBytes)
      },
      handler: "index.handler",
      code: Code.fromInline(NEON_USAGE_SOURCE)
    });

    apiKey.grantRead(fn);
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ["cloudwatch:PutMetricData"],
        // PutMetricData has no resource-level permissions; the condition pins the namespace.
        resources: ["*"],
        conditions: { StringEquals: { "cloudwatch:namespace": NEON_USAGE_METRIC.namespace } }
      })
    );

    new Schedule(this, "NeonUsageSchedule", {
      scheduleName: functionName,
      description: "Runs the Neon usage check (ADR-0022)",
      schedule: ScheduleExpression.rate(Duration.hours(NEON_USAGE_INTERVAL_HOURS)),
      target: new LambdaInvoke(fn, { retryAttempts: 0 })
    });

    return fn;
  }
}

const NEON_USAGE_SOURCE = `
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");

exports.handler = async () => {
  const env = process.env;
  const key = await new SSMClient({}).send(new GetParameterCommand({ Name: env.API_KEY_PARAMETER, WithDecryption: true }));
  const response = await fetch("https://console.neon.tech/api/v2/projects/" + env.NEON_PROJECT_ID, {
    headers: { Authorization: "Bearer " + key.Parameter.Value, Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Neon API returned " + response.status);
  const { project } = await response.json();

  const percent = {
    compute: (100 * project.compute_time_seconds) / Number(env.LIMIT_COMPUTE_SECONDS),
    storage: (100 * project.synthetic_storage_size) / Number(env.LIMIT_STORAGE_BYTES),
    egress: (100 * project.data_transfer_bytes) / Number(env.LIMIT_EGRESS_BYTES)
  };
  for (const [name, value] of Object.entries(percent)) {
    if (!Number.isFinite(value)) throw new Error("Neon API returned no usable " + name + " figure");
  }
  const highest = Math.max(...Object.values(percent));
  console.log(JSON.stringify({ check: "neon-usage", percent, highest, periodEnd: project.consumption_period_end }));

  await new CloudWatchClient({}).send(new PutMetricDataCommand({
    Namespace: "${NEON_USAGE_METRIC.namespace}",
    MetricData: [{ MetricName: "${NEON_USAGE_METRIC.metricName}", Dimensions: [{ Name: "Environment", Value: env.ENVIRONMENT }], Value: highest, Unit: "Percent" }]
  }));
};
`;
