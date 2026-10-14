import { Duration } from "aws-cdk-lib";
import {
  ApplicationLogLevel,
  Architecture,
  Code,
  Function as LambdaFunction,
  LoggingFormat,
  Runtime,
  SystemLogLevel,
  Tracing
} from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { TempoEnvironmentConfig } from "../../config/environment-config";
import { applyStandardTags, DataClassification } from "./tagging";
import { createLogGroup } from "./log-group-defaults";

export interface TempoFunctionProps {
  /** Physical function name, e.g. "tempo-dev-api". */
  readonly functionName: string;
  readonly component: string;
  readonly description: string;
  readonly code: Code;
  readonly handler: string;
  readonly memoryMb: number;
  readonly timeoutSeconds: number;
  /**
   * Reserved concurrency. Required for every database-connected function to
   * bound database connection pressure (LLD section 10.6); omit only for
   * functions with no downstream capacity constraint.
   */
  readonly reservedConcurrentExecutions?: number;
  /** Non-secret environment variables only - identifiers and ARNs, never secret values (LLD section 12.5). */
  readonly environment?: Record<string, string>;
  readonly dataClassification?: DataClassification;
}

/**
 * Standard AWS Lambda construction for every Tempo .NET function: managed
 * .NET 10 runtime (ADR-0016), arm64, explicit log group/retention, tracing,
 * structured JSON logging and the mandatory tag set. Handlers stay thin -
 * this construct only owns technical plumbing, never business behavior.
 */
export class TempoFunction extends Construct {
  public readonly function: LambdaFunction;

  constructor(scope: Construct, id: string, config: TempoEnvironmentConfig, props: TempoFunctionProps) {
    super(scope, id);

    const logGroup = createLogGroup(this, "LogGroup", config, {
      logGroupName: `/aws/lambda/${props.functionName}`
    });

    this.function = new LambdaFunction(this, "Function", {
      functionName: props.functionName,
      description: props.description,
      runtime: Runtime.DOTNET_10,
      architecture: Architecture.ARM_64,
      code: props.code,
      handler: props.handler,
      memorySize: props.memoryMb,
      timeout: Duration.seconds(props.timeoutSeconds),
      logGroup,
      tracing: config.observability.enableTracing ? Tracing.ACTIVE : Tracing.DISABLED,
      loggingFormat: LoggingFormat.JSON,
      applicationLogLevelV2: ApplicationLogLevel.INFO,
      systemLogLevelV2: SystemLogLevel.WARN,
      reservedConcurrentExecutions: props.reservedConcurrentExecutions,
      environment: {
        TEMPO_ENVIRONMENT: config.environmentName,
        TEMPO_REGION: config.region,
        LOG_LEVEL: config.environmentName === "prod" ? "Information" : "Debug",
        OTEL_SERVICE_NAME: props.functionName,
        ...props.environment
      }
    });

    applyStandardTags(this, config, props.component, props.dataClassification);
  }
}
