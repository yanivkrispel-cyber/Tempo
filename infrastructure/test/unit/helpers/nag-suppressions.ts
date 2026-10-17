/**
 * Accepted cdk-nag AwsSolutions findings (ADR-0025). Each entry is acknowledged
 * only on the constructs it names (paths relative to the stage), never on a
 * whole stack, so the same finding on a new resource still fails. Each one
 * says why it is accepted, or which issue tracks the fix. Never acknowledge a
 * finding to make CI green without one of the two.
 */
export interface NagAcknowledgment {
  /** The rule, or one finding of it: `AwsSolutions-IAM5[Resource::*]`. */
  readonly id: string;
  readonly reason: string;
  /** Construct paths below the stage, such as `Api/HttpApi`. */
  readonly paths: readonly string[];
}

const LAMBDA_ROLES = [
  "Api/ApiFunction/Function/ServiceRole",
  "Database/MigratorFunction/Function/ServiceRole",
  "Database/NeonUsageFunction/ServiceRole",
  "Messaging/OutboxWorkerFunction/Function/ServiceRole",
  "Edge/CanaryFunction/ServiceRole",
  "Canary/CanaryFunction/ServiceRole"
];

const TRACKED_IN_CFR4 = "Needs the custom domain and an ACM certificate; tracked in issue #241 (moved out of #109).";

export const NAG_ACKNOWLEDGMENTS: NagAcknowledgment[] = [
  {
    id: "AwsSolutions-APIG4",
    reason:
      "No gateway authorizer by design: the API validates both Cognito pools' tokens itself (backend-patterns.md, " +
      "CognitoAuthentication), and ArchitectureTests require every endpoint to declare authorization or be on the public list.",
    paths: ["Api/HttpApi"]
  },
  {
    id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
    reason: "The AWS-managed basic execution policy only allows writing the function's own CloudWatch logs.",
    paths: LAMBDA_ROLES
  },
  {
    id: "AwsSolutions-IAM5[Resource::*]",
    reason:
      "xray:PutTraceSegments and xray:PutTelemetryRecords (active tracing) and cloudwatch:PutMetricData (pinned to " +
      "the Tempo/Database namespace by a condition) have no resource-level permissions.",
    paths: LAMBDA_ROLES.filter((path) => !path.startsWith("Edge/"))
  },
  {
    id: "AwsSolutions-IAM5[Resource::<NeonUsageFunction64053658.Arn>:*]",
    reason: "EventBridge Scheduler's role may invoke this one function and its versions; CDK adds the :* suffix.",
    paths: ["Database"]
  },
  {
    id: "AwsSolutions-IAM5[Resource::<CanaryFunctionD1692701.Arn>:*]",
    reason: "EventBridge Scheduler's role may invoke this one function and its versions; CDK adds the :* suffix.",
    paths: ["Edge", "Canary"]
  },
  {
    id: "AwsSolutions-IAM5[Resource::arn:aws:iam::687239340846:role/cdk-*]",
    reason: "The GitHub OIDC deploy role may only assume the CDK bootstrap roles of its own account (ADR-0011).",
    paths: ["GitHubOidc/DeploymentRole"]
  },
  {
    id: "AwsSolutions-IAM5[Resource::arn:aws:iam::000000000000:role/cdk-*]",
    reason: "The GitHub OIDC deploy role may only assume the CDK bootstrap roles of its own account (ADR-0011).",
    paths: ["GitHubOidc/DeploymentRole"]
  },
  {
    id: "AwsSolutions-COG2",
    reason:
      "MFA is optional in the customer pool (members sign in without it); the API requires TOTP for studio owners " +
      "(OwnerMfaTests, migration 0007). The operator pool requires MFA except on dev, where `operatorMfa` is " +
      "optional for the testing phase (ADR-0023 amendment); config validation refuses that in production and " +
      "identity.test.ts asserts MFA ON for prod.",
    paths: ["Identity/UserPool", "Identity/OperatorPool"]
  },
  {
    id: "AwsSolutions-COG8",
    reason: "The Plus feature plan is a recurring charge; $0 until revenue (ADR-0021). Essentials is the chosen tier (ADR-0007).",
    paths: ["Identity/UserPool", "Identity/OperatorPool"]
  },
  {
    id: "AwsSolutions-CFR1",
    reason: "No geo restriction on purpose: studio members travel, and the WAF rate rules cover abuse (ADR-0009).",
    paths: ["Edge/Distribution"]
  },
  {
    id: "AwsSolutions-CFR3",
    reason: "CloudFront standard logs are a paid S3 sink; $0 until revenue (ADR-0021). WAF sampled requests stay on.",
    paths: ["Edge/Distribution"]
  },
  {
    id: "AwsSolutions-S1",
    reason: "The PWA bucket is private behind CloudFront origin access and holds only the public build; access logs cost storage (ADR-0021).",
    paths: ["Edge/PwaBucket"]
  },
  { id: "AwsSolutions-CFR4", reason: TRACKED_IN_CFR4, paths: ["Edge/Distribution"] }
];
