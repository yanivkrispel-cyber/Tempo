import { Stack, StackProps } from "aws-cdk-lib";
import { CfnAnalyzer } from "aws-cdk-lib/aws-accessanalyzer";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export interface SecurityStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * Account-wide detective security control (LLD section 30). IAM Access
 * Analyzer is free and flags any resource (IAM role, S3 bucket, KMS key,
 * Secrets Manager secret, SQS queue) that becomes reachable from outside
 * this account - a real, no-cost backstop for "no public S3 bucket" / "no
 * wildcard IAM policy" beyond what CDK unit tests can catch at synth time.
 *
 * An account-level IAM password policy was considered but is not a native
 * CloudFormation resource (no `AWS::IAM::AccountPasswordPolicy` type exists;
 * it requires a custom resource backed by an SDK call). Given ADR-0014
 * mandates IAM Identity Center for all human access - no long-lived IAM
 * users with passwords in normal operation - the value of adding that
 * custom resource in this phase is low, so it is deferred rather than built.
 */
export class SecurityStack extends Stack {
  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);
    const { config } = props;

    new CfnAnalyzer(this, "AccountAccessAnalyzer", {
      analyzerName: resourceName(config, "access-analyzer"),
      type: "ACCOUNT"
    });

    applyStandardTags(this, config, "security");
  }
}
