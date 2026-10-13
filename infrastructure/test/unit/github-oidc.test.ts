import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

describe("GitHub OIDC deployment role trust (ADR-0011)", () => {
  const child = dev.node.findChild("GitHubOidc");
  if (!Stack.isStack(child)) throw new Error("GitHubOidc is not a Stack");
  const template = Template.fromStack(child);

  it("restricts sts:AssumeRoleWithWebIdentity to the exact repository and branch", () => {
    const roles = template.findResources("AWS::IAM::Role");
    const deploymentRole = Object.values(roles).find((r) =>
      JSON.stringify(r.Properties.AssumeRolePolicyDocument).includes("AssumeRoleWithWebIdentity")
    );

    expect(deploymentRole).toBeDefined();

    const statement = deploymentRole!.Properties.AssumeRolePolicyDocument.Statement[0];
    expect(statement.Condition.StringEquals["token.actions.githubusercontent.com:aud"]).toBe("sts.amazonaws.com");
    expect(statement.Condition.StringLike["token.actions.githubusercontent.com:sub"]).toBe(
      "repo:yanivkrispel-cyber/Tempo:ref:refs/heads/main"
    );
  });

  it("never trusts every branch or repository with a bare wildcard", () => {
    const roles = template.findResources("AWS::IAM::Role");
    const deploymentRole = Object.values(roles).find((r) =>
      JSON.stringify(r.Properties.AssumeRolePolicyDocument).includes("AssumeRoleWithWebIdentity")
    );
    const sub = deploymentRole!.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringLike[
      "token.actions.githubusercontent.com:sub"
    ];

    expect(sub).not.toBe("*");
    expect(sub).not.toMatch(/^repo:\*/);
  });

  it("deploys through the CDK bootstrap roles, never a broad admin policy", () => {
    template.hasResourceProperties(
      "AWS::IAM::Policy",
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sts:AssumeRole",
              Resource: Match.stringLikeRegexp("role/cdk-\\*")
            })
          ])
        })
      })
    );
  });

  function deploymentRoleStatements(): Array<{ Sid?: string; Action: string | string[]; Resource: unknown }> {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    return policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
  }

  it("may invoke only the database migrator function", () => {
    const invoke = deploymentRoleStatements().filter((s) => [s.Action].flat().includes("lambda:InvokeFunction"));

    expect(invoke).toHaveLength(1);
    expect(invoke[0].Resource).toBe("arn:aws:lambda:eu-central-1:254631022581:function:tempo-dev-database-migrator");
  });

  it("may use only the smoke-test queue, and only to send and inspect", () => {
    const sqs = deploymentRoleStatements().filter((s) => [s.Action].flat().some((a) => a.startsWith("sqs:")));

    expect(sqs).toHaveLength(1);
    expect([sqs[0].Action].flat().sort()).toEqual(["sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:SendMessage"]);
    expect(sqs[0].Resource).toBe("arn:aws:sqs:eu-central-1:254631022581:tempo-dev-smoke-test");
  });
});
