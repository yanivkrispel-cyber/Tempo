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
  ["dev", dev, "OPTIONAL"],
  ["prod", prod, "ON"]
] as const)("Identity pools in %s (ADR-0023)", (env, stage, operatorMfa) => {
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

  it(`the operator pool has MFA ${operatorMfa} with TOTP only and no self sign-up`, () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: `tempo-${env}-operators`,
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: operatorMfa,
      EnabledMfas: ["SOFTWARE_TOKEN_MFA"]
    });
  });

  it("both pools keep the original email until a changed one is verified (#124)", () => {
    const pools = Object.values(template.findResources("AWS::Cognito::UserPool"));
    expect(pools).toHaveLength(2);
    for (const pool of pools) {
      expect(pool.Properties.UserAttributeUpdateSettings).toEqual({ AttributesRequireVerificationBeforeUpdate: ["email"] });
    }
  });

  it("no app client allows SRP, the plain password flow or custom auth (#124)", () => {
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    expect(clients).toHaveLength(3);
    for (const client of clients) {
      const flows = client.Properties.ExplicitAuthFlows as string[];
      expect(flows).toContain("ALLOW_REFRESH_TOKEN_AUTH");
      expect(flows).not.toContain("ALLOW_USER_SRP_AUTH");
      expect(flows).not.toContain("ALLOW_USER_PASSWORD_AUTH");
      expect(flows).not.toContain("ALLOW_CUSTOM_AUTH");
    }
  });

  it("only client-web allows choice-based sign-in, for the members' own sign-in screen (ADR-0028)", () => {
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    const withUserAuth = clients
      .filter((client) => (client.Properties.ExplicitAuthFlows as string[]).includes("ALLOW_USER_AUTH"))
      .map((client) => client.Properties.ClientName as string);
    expect(withUserAuth).toEqual([`tempo-${env}-client-web`]);
  });

  it("client-web writes only email and reads only email and its verification (docs/36 F-7)", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: `tempo-${env}-client-web`,
      WriteAttributes: ["email"],
      ReadAttributes: Match.arrayEquals(["email", "email_verified"])
    });
  });

  it("the customer pool offers password and passkey first, with the members app as the passkey's relying party", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: `tempo-${env}-users`,
      UserPoolTier: "ESSENTIALS",
      Policies: Match.objectLike({ SignInPolicy: { AllowedFirstAuthFactors: ["PASSWORD", "WEB_AUTHN"] } }),
      WebAuthnRelyingPartyID: env === "dev" ? "tempo-members.pages.dev" : "client.tempo.example",
      WebAuthnUserVerification: "preferred"
    });
  });

  it("the operator pool keeps password sign-in only", () => {
    const pools = template.findResources("AWS::Cognito::UserPool", { Properties: { UserPoolName: `tempo-${env}-operators` } });
    const pool = Object.values(pools)[0].Properties;
    expect(pool.WebAuthnRelyingPartyID).toBeUndefined();
    expect(pool.Policies?.SignInPolicy?.AllowedFirstAuthFactors ?? ["PASSWORD"]).toEqual(["PASSWORD"]);
  });

  it("the customer pool has only admin-web and client-web", () => {
    const pool = poolLogicalId(template, `tempo-${env}-users`);
    expect(clientNamesOf(template, pool)).toEqual([
      `tempo-${env}-admin-web`,
      `tempo-${env}-client-web`
    ]);
  });

  it("admin-web may manage its own MFA, write only email and read only email and its verification", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: `tempo-${env}-admin-web`,
      AllowedOAuthScopes: Match.arrayWith(["aws.cognito.signin.user.admin"]),
      WriteAttributes: ["email"],
      ReadAttributes: Match.arrayEquals(["email", "email_verified"])
    });
  });

  it("client-web does not ask for the user-admin scope through OAuth", () => {
    const clients = template.findResources("AWS::Cognito::UserPoolClient", {
      Properties: { ClientName: `tempo-${env}-client-web` }
    });
    const scopes = Object.values(clients)[0].Properties.AllowedOAuthScopes as string[];
    expect(scopes).not.toContain("aws.cognito.signin.user.admin");
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

  it("the API may read and delete users in the customer pool and do nothing else in Cognito", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const cognitoStatements = policies
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>)
      .filter((statement) => [statement.Action].flat().some((action) => action.startsWith("cognito-idp:")));

    expect(cognitoStatements).toHaveLength(1);
    expect([cognitoStatements[0].Action].flat().sort()).toEqual(["cognito-idp:AdminDeleteUser", "cognito-idp:AdminGetUser"]);
    expect(JSON.stringify(cognitoStatements[0].Resource)).toContain("UserPool");
    expect(JSON.stringify(cognitoStatements[0].Resource)).not.toContain("OperatorPool");
  });
});

describe("Smoke-test sign-in (day board #60, decision 5)", () => {
  function clientWebAuthFlows(stage: TempoStage): string[] {
    const clients = stackTemplate(stage, "Identity").findResources("AWS::Cognito::UserPoolClient");
    const clientWeb = Object.values(clients).find((c) => (c.Properties.ClientName as string).endsWith("-client-web"));
    return [...(clientWeb?.Properties.ExplicitAuthFlows ?? [])].sort();
  }

  it("dev's client-web also allows the admin-only password flow", () => {
    expect(clientWebAuthFlows(dev)).toContain("ALLOW_ADMIN_USER_PASSWORD_AUTH");
    expect(clientWebAuthFlows(dev)).not.toContain("ALLOW_USER_PASSWORD_AUTH");
  });

  it("prod's client-web does not", () => {
    expect(clientWebAuthFlows(prod)).not.toContain("ALLOW_ADMIN_USER_PASSWORD_AUTH");
  });
});
