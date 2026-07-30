import { RemovalPolicy } from "aws-cdk-lib";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { TempoEnvironmentConfig } from "../../config/environment-config";

const RETENTION_DAYS_MAP: Record<number, RetentionDays> = {
  1: RetentionDays.ONE_DAY,
  3: RetentionDays.THREE_DAYS,
  5: RetentionDays.FIVE_DAYS,
  7: RetentionDays.ONE_WEEK,
  14: RetentionDays.TWO_WEEKS,
  30: RetentionDays.ONE_MONTH,
  60: RetentionDays.TWO_MONTHS,
  90: RetentionDays.THREE_MONTHS,
  120: RetentionDays.FOUR_MONTHS,
  150: RetentionDays.FIVE_MONTHS,
  180: RetentionDays.SIX_MONTHS,
  365: RetentionDays.ONE_YEAR
};

function toRetention(days: number): RetentionDays {
  const retention = RETENTION_DAYS_MAP[days];
  if (!retention) {
    throw new Error(
      `Unsupported log retention of ${days} days. Use one of: ${Object.keys(RETENTION_DAYS_MAP).join(", ")}`
    );
  }
  return retention;
}

export interface TempoLogGroupProps {
  /** Explicit log group name, e.g. "/aws/lambda/tempo-dev-api". */
  readonly logGroupName: string;
  /** Overrides config.observability.logRetentionDays when set. */
  readonly retentionDays?: number;
}

/**
 * Creates a CloudWatch log group with explicit retention and an
 * environment-aware removal policy (LLD section 34.4 / 25.2). Infinite
 * retention is never used. Production log groups are retained on stack
 * deletion; non-production log groups are destroyed to avoid orphaned cost.
 */
export function createLogGroup(
  scope: Construct,
  id: string,
  config: TempoEnvironmentConfig,
  props: TempoLogGroupProps
): LogGroup {
  return new LogGroup(scope, id, {
    logGroupName: props.logGroupName,
    retention: toRetention(props.retentionDays ?? config.observability.logRetentionDays),
    removalPolicy: config.environmentName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
  });
}
