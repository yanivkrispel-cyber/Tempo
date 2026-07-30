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

  it("only assumes the CDK bootstrap roles, never a broad admin policy", () => {
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
});
