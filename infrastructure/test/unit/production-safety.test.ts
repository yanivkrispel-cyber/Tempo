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

describe("Production database access (ADR-0022)", () => {
  it("the migrator reads only the production database parameters", () => {
    const template = stackTemplate("Database");
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as Array<{ Resource: unknown }>
    );
    const resources = JSON.stringify(statements.map((s) => s.Resource));
    expect(resources).toContain("parameter/tempo/prod/db/neon-connection-string");
    expect(resources).not.toContain("/tempo/dev/");
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
