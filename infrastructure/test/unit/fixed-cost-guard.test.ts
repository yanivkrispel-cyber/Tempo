import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";

/**
 * ADR-0021: no resource with a fixed hourly or monthly charge unless a
 * tripwire allows it. This test lists every such resource the stages
 * synthesize and fails on any that is not in the allowlist below. Each
 * allowlist entry names the stack path, the reason, and when it goes away,
 * so the debt stays visible in code review.
 */
const FIXED_COST_TYPES: Record<string, string> = {
  "AWS::EC2::NatGateway": "about $38 a month per gateway plus data processing",
  "AWS::EC2::EIP": "public IPv4 address, $3.65 a month",
  "AWS::EC2::VPCEndpoint": "interface endpoint, $8.76 a month per AZ (gateway endpoints are free)",
  "AWS::RDS::DBCluster": "Aurora storage and, without auto-pause, minimum capacity",
  "AWS::RDS::DBInstance": "Aurora instance capacity",
  "AWS::SecretsManager::Secret": "$0.40 a month per secret",
  "AWS::KMS::Key": "customer-managed key, $1 a month",
  "AWS::WAFv2::WebACL": "$5 a month plus $1 per rule outside the CloudFront Free plan",
  "AWS::Route53::HostedZone": "$0.50 a month unless attached to the CloudFront Free plan",
  "AWS::ElastiCache::CacheCluster": "always-on cache nodes",
  "AWS::ElastiCache::ReplicationGroup": "always-on cache nodes",
  "AWS::ElastiCache::ServerlessCache": "minimum storage charge",
  "AWS::OpenSearchService::Domain": "always-on search nodes",
  "AWS::EC2::Instance": "always-on compute",
  "AWS::ECS::Service": "always-on containers",
  "AWS::ElasticLoadBalancingV2::LoadBalancer": "load balancer hours",
  "AWS::GuardDuty::Detector": "per-event analysis charges",
  "AWS::Config::ConfigurationRecorder": "per configuration item",
  "AWS::SecurityHub::Hub": "per check"
};

interface AllowedFixedCost {
  /** Stack path inside the stage, e.g. "Network". */
  readonly stack: string;
  readonly type: string;
  readonly reason: string;
}

/**
 * Reviewed exceptions. Empty since ADR-0022 removed the VPC endpoint, Aurora
 * and the Secrets Manager secrets. A new entry needs owner approval under an
 * ADR-0021 tripwire; delete it when its resource goes.
 */
const ALLOWED: readonly AllowedFixedCost[] = [];

/**
 * Logical IDs that a FREE-tier CloudFront flat-rate plan in the same stack
 * covers (ADR-0021: the Free plan bills the distribution, its web ACL and the
 * web ACL's rules at $0).
 */
function coveredByFreePlan(resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>) {
  const covered = new Set<string>();
  for (const resource of Object.values(resources)) {
    if (resource.Type !== "AWS::PricingPlanManager::Subscription" || resource.Properties?.PlanTier !== "FREE") continue;
    for (const arn of (resource.Properties.ResourceArns as unknown[]) ?? []) {
      const getAtt = (arn as { "Fn::GetAtt"?: [string, string] })["Fn::GetAtt"];
      if (getAtt) covered.add(getAtt[0]);
    }
  }
  return covered;
}

function fixedCostResources(stage: typeof dev) {
  const found: Array<{ stack: string; type: string; logicalId: string }> = [];
  for (const stack of stage.node.findAll().filter(Stack.isStack)) {
    const resources = Template.fromStack(stack).toJSON().Resources ?? {};
    const freePlan = coveredByFreePlan(resources);
    for (const [logicalId, resource] of Object.entries<{ Type: string; Properties?: Record<string, unknown> }>(resources)) {
      // Provisioned concurrency bills by the hour whether or not it is used.
      const provisioned =
        (resource.Type === "AWS::Lambda::Version" || resource.Type === "AWS::Lambda::Alias") &&
        resource.Properties?.ProvisionedConcurrencyConfig !== undefined;
      if (!provisioned && !(resource.Type in FIXED_COST_TYPES)) continue;
      if (resource.Type === "AWS::EC2::VPCEndpoint" && resource.Properties?.VpcEndpointType === "Gateway") continue;
      if (freePlan.has(logicalId)) continue;
      found.push({ stack: stack.node.id, type: provisioned ? "ProvisionedConcurrency" : resource.Type, logicalId });
    }
  }
  return found;
}

describe("No fixed-cost resources outside the allowlist (ADR-0021)", () => {
  const stages = [
    ["dev", dev],
    ["prod", prod]
  ] as const;

  it.each(stages)("%s has no fixed-cost resource outside the allowlist", (_name, stage) => {
    const unexpected = fixedCostResources(stage).filter(
      (r) => !ALLOWED.some((a) => a.stack === r.stack && a.type === r.type)
    );
    expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const found = stages.flatMap(([, stage]) => fixedCostResources(stage));
    const stale = ALLOWED.filter((a) => !found.some((r) => r.stack === a.stack && r.type === a.type));
    expect(stale, `Remove these entries; their resources are gone: ${JSON.stringify(stale, null, 2)}`).toEqual([]);
  });
});
