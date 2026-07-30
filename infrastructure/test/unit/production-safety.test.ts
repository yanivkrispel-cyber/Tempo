import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { prod } from "./helpers/synth";

function stackTemplate(childId: string) {
  const child = prod.node.findChild(childId);
  if (!Stack.isStack(child)) {
    throw new Error(`Expected stage child '${childId}' to be a Stack`);
  }
  return Template.fromStack(child);
}

describe("Production Aurora safety (LLD sections 10.2, 34, 35)", () => {
  const template = stackTemplate("Database");

  it("has deletion protection enabled", () => {
    template.hasResourceProperties("AWS::RDS::DBCluster", { DeletionProtection: true });
  });

  it("has auto-pause disabled (no SecondsUntilAutoPause) and a non-zero minimum ACU", () => {
    const clusters = template.findResources("AWS::RDS::DBCluster");
    const [cluster] = Object.values(clusters);
    const scaling = cluster.Properties.ServerlessV2ScalingConfiguration;

    expect(scaling.SecondsUntilAutoPause).toBeUndefined();
    expect(scaling.MinCapacity).toBeGreaterThan(0);
  });

  it("uses a safe removal policy (Snapshot or Retain, never Delete)", () => {
    const clusters = template.findResources("AWS::RDS::DBCluster");
    const [cluster] = Object.values(clusters);
    expect(["Snapshot", "Retain"]).toContain(cluster.DeletionPolicy);
  });

  it("is still not publicly accessible in production", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", { PubliclyAccessible: false });
  });
});

describe("Production Secrets Manager removal policy", () => {
  it("application and migrator secrets are retained on stack deletion", () => {
    const template = stackTemplate("Database");
    const secrets = template.findResources("AWS::SecretsManager::Secret");
    const nonMasterSecrets = Object.values(secrets).filter(
      (s) => !JSON.stringify(s.Properties).includes("tempo_master")
    );
    expect(nonMasterSecrets.length).toBeGreaterThan(0);
    for (const secret of nonMasterSecrets) {
      expect(secret.DeletionPolicy).toBe("Retain");
    }
  });
});

describe("Production observability requires an alarm destination", () => {
  it("creates an SNS topic with an email subscription", () => {
    const template = stackTemplate("Observability");
    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", Match.objectLike({ Protocol: "email" }));
  });
});

describe("Production GitHub deployment requires a protected environment", () => {
  it("trust condition references a GitHub Environment, not just a branch", () => {
    const template = stackTemplate("GitHubOidc");
    const roles = template.findResources("AWS::IAM::Role", {
      Properties: { AssumeRolePolicyDocument: Match.anyValue() }
    });
    const deploymentRole = Object.values(roles).find((r) =>
      JSON.stringify(r.Properties.AssumeRolePolicyDocument).includes("AssumeRoleWithWebIdentity")
    );
    expect(deploymentRole).toBeDefined();
    const sub = JSON.stringify(deploymentRole!.Properties.AssumeRolePolicyDocument);
    expect(sub).toContain(":environment:production");
  });
});
