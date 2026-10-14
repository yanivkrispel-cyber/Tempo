import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";
import { TempoStage } from "../../lib/tempo-stage";

function stackTemplate(stage: TempoStage, childId: string) {
  const child = stage.node.findChild(childId);
  if (!Stack.isStack(child)) {
    throw new Error(`Expected stage child '${childId}' to be a Stack`);
  }
  return Template.fromStack(child);
}

function poolLogicalId(template: Template, poolName: string): string {
  const pools = template.findResources("AWS::Cognito::UserPool", { Properties: { UserPoolName: poolName } });
  const ids = Object.keys(pools);
  expect(ids).toHaveLength(1);
  return ids[0];
}

function clientNamesOf(template: Template, poolLogicalIdValue: string): string[] {
  const clients = template.findResources("AWS::Cognito::UserPoolClient", {
    Properties: { UserPoolId: { Ref: poolLogicalIdValue } }
  });
  return Object.values(clients)
    .map((client) => client.Properties.ClientName as string)
    .sort();
}

describe.each([
  ["dev", dev],
  ["prod", prod]
] as const)("Identity pools in %s (ADR-0023)", (env, stage) => {
  const template = stackTemplate(stage, "Identity");

  it("has exactly two user pools", () => {
    template.resourceCountIs("AWS::Cognito::UserPool", 2);
  });

  it("the customer pool allows self sign-up and keeps MFA optional", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: `tempo-${env}-users`,
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      MfaConfiguration: "OPTIONAL"
    });
  });

  it("the operator pool requires MFA with TOTP only and no self sign-up", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: `tempo-${env}-operators`,
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: "ON",
      EnabledMfas: ["SOFTWARE_TOKEN_MFA"]
    });
  });

  it("the customer pool has only admin-web and client-web", () => {
    const pool = poolLogicalId(template, `tempo-${env}-users`);
    expect(clientNamesOf(template, pool)).toEqual([
      `tempo-${env}-admin-web`,
      `tempo-${env}-client-web`
    ]);
  });

  it("the operator pool has only the platform-admin-web client, with short sessions", () => {
    const pool = poolLogicalId(template, `tempo-${env}-operators`);
    expect(clientNamesOf(template, pool)).toEqual([`tempo-${env}-operators-platform-admin-web`]);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: `tempo-${env}-operators-platform-admin-web`,
      GenerateSecret: false,
      AccessTokenValidity: 15,
      RefreshTokenValidity: 720,
      TokenValidityUnits: Match.objectLike({ AccessToken: "minutes", RefreshToken: "minutes" })
    });
  });
});

describe("API configuration for two pools (ADR-0023)", () => {
  const template = stackTemplate(dev, "Api");

  it("the API function knows both issuers and both client lists", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "tempo-dev-api",
      Environment: {
        Variables: Match.objectLike({
          COGNITO_ISSUER: Match.anyValue(),
          COGNITO_CLIENT_IDS: Match.anyValue(),
          COGNITO_OPERATOR_ISSUER: Match.anyValue(),
          COGNITO_OPERATOR_CLIENT_IDS: Match.anyValue()
        })
      }
    });
  });

  it("the API may read users from the customer pool and nothing else in Cognito", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const cognitoStatements = policies
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>)
      .filter((statement) => [statement.Action].flat().some((action) => action.startsWith("cognito-idp:")));

    expect(cognitoStatements).toHaveLength(1);
    expect(cognitoStatements[0].Action).toBe("cognito-idp:AdminGetUser");
    expect(JSON.stringify(cognitoStatements[0].Resource)).toContain("UserPool");
    expect(JSON.stringify(cognitoStatements[0].Resource)).not.toContain("OperatorPool");
  });
});
