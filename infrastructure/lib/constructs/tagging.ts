import { Stack, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TempoEnvironmentConfig } from "../../config/environment-config";

export type DataClassification = "Public" | "Internal" | "Confidential" | "Restricted";

/**
 * Applies the mandatory Tempo tag set (LLD section 5) to every resource
 * under `scope`. Call once per stack/construct with the component name that
 * stack owns; nested constructs inherit the tags automatically.
 *
 * When `scope` is a stack, the stack itself is tagged too. Under the
 * `@aws-cdk/core:explicitStackTags` flag, Tags.of() no longer tags stacks.
 */
export function applyStandardTags(
  scope: Construct,
  config: TempoEnvironmentConfig,
  component: string,
  dataClassification: DataClassification = "Internal"
): void {
  const tags: Record<string, string> = {
    Application: "Tempo",
    Environment: config.environmentName,
    ManagedBy: "AWS-CDK",
    Owner: config.tags.owner,
    CostCenter: config.tags.costCenter,
    DataClassification: dataClassification,
    Component: component
  };
  for (const [key, value] of Object.entries(tags)) {
    Tags.of(scope).add(key, value);
    if (Stack.isStack(scope)) scope.tags.setTag(key, value);
  }
}
