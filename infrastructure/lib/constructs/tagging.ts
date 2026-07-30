import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TempoEnvironmentConfig } from "../../config/environment-config";

export type DataClassification = "Public" | "Internal" | "Confidential" | "Restricted";

/**
 * Applies the mandatory Tempo tag set (LLD section 5) to every resource
 * under `scope`. Call once per stack/construct with the component name that
 * stack owns; nested constructs inherit the tags automatically.
 */
export function applyStandardTags(
  scope: Construct,
  config: TempoEnvironmentConfig,
  component: string,
  dataClassification: DataClassification = "Internal"
): void {
  Tags.of(scope).add("Application", "Tempo");
  Tags.of(scope).add("Environment", config.environmentName);
  Tags.of(scope).add("ManagedBy", "AWS-CDK");
  Tags.of(scope).add("Owner", config.tags.owner);
  Tags.of(scope).add("CostCenter", config.tags.costCenter);
  Tags.of(scope).add("DataClassification", dataClassification);
  Tags.of(scope).add("Component", component);
}
