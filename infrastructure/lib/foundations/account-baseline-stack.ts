import { CfnAnomalyMonitor, CfnAnomalySubscription } from "aws-cdk-lib/aws-ce";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export interface AccountBaselineStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * Account-wide cost baseline (ADR-0020, LLD sections 5/29). Deployed once
 * per AWS account. Cost Anomaly Detection requires Cost Explorer to already
 * be enabled on the account; if it is not, comment out the
 * CfnAnomalyMonitor/Subscription resources until it has been (this is a
 * one-time, non-CDK-automatable account setting).
 *
 * Account-level S3 Block Public Access (`s3control:PutPublicAccessBlock`) is
 * not a CloudFormation resource type, and no S3 bucket exists in this phase
 * anyway - every bucket this repo creates in a later phase must set its own
 * per-bucket `blockPublicAccess` (see lib/constructs/secure-bucket.ts, LLD
 * section 34.1), and the account-level setting should be added as a one-time
 * account setup step (or a custom resource) when the first bucket lands.
 */
export class AccountBaselineStack extends Stack {
  constructor(scope: Construct, id: string, props: AccountBaselineStackProps) {
    super(scope, id, props);
    const { config } = props;

    new CfnBudget(this, "MonthlyCostBudget", {
      budget: {
        budgetName: resourceName(config, "monthly-cost-budget"),
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: config.environmentName === "prod" ? 1000 : 200,
          unit: "USD"
        }
      },
      notificationsWithSubscribers: config.observability.alarmEmail
        ? [
            {
              notification: {
                notificationType: "ACTUAL",
                comparisonOperator: "GREATER_THAN",
                threshold: 80,
                thresholdType: "PERCENTAGE"
              },
              subscribers: [{ subscriptionType: "EMAIL", address: config.observability.alarmEmail }]
            },
            {
              notification: {
                notificationType: "FORECASTED",
                comparisonOperator: "GREATER_THAN",
                threshold: 100,
                thresholdType: "PERCENTAGE"
              },
              subscribers: [{ subscriptionType: "EMAIL", address: config.observability.alarmEmail }]
            }
          ]
        : undefined
    });

    const anomalyMonitor = new CfnAnomalyMonitor(this, "CostAnomalyMonitor", {
      monitorName: resourceName(config, "cost-anomaly-monitor"),
      monitorType: "DIMENSIONAL",
      monitorDimension: "SERVICE"
    });

    if (config.observability.alarmEmail) {
      new CfnAnomalySubscription(this, "CostAnomalySubscription", {
        subscriptionName: resourceName(config, "cost-anomaly-subscription"),
        frequency: "DAILY",
        monitorArnList: [anomalyMonitor.attrMonitorArn],
        subscribers: [{ type: "EMAIL", address: config.observability.alarmEmail }],
        threshold: 50
      });
    }

    applyStandardTags(this, config, "account-baseline");
  }
}
