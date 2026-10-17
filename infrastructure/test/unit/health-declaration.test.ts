import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

function stackTemplate(childId: string) {
  const child = dev.node.findChild(childId);
  if (!Stack.isStack(child)) throw new Error(`${childId} is not a Stack`);
  return Template.fromStack(child);
}

function statements(template: Template) {
  return Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[]
  );
}

const asText = (value: unknown) => JSON.stringify(value);

describe("the health data key (docs/31 section 7, ADR-0026)", () => {
  const api = stackTemplate("Api");
  const messaging = stackTemplate("Messaging");

  it("the API names the key path and the current version", () => {
    const fn = Object.values(api.findResources("AWS::Lambda::Function")).find((f) =>
      String(f.Properties.FunctionName).endsWith("-api")
    );
    const env = fn?.Properties.Environment.Variables as Record<string, unknown>;
    expect(env.HEALTH_DATA_KEY_PARAMETER_PREFIX).toBe("/tempo/dev/health/data-key/");
    expect(env.HEALTH_DATA_KEY_CURRENT_VERSION).toBe("1");
  });

  it("only the API may read it, version by version, with no wildcard and no KMS statement", () => {
    const reads = statements(api).filter((s) => asText(s.Resource).includes("health/data-key"));
    expect(reads).toHaveLength(1);
    expect(reads[0].Action).toBe("ssm:GetParameter");
    expect(asText(reads[0].Resource)).toContain(":parameter/tempo/dev/health/data-key/1");
    expect(asText(reads[0].Resource)).not.toContain("*");
    expect(asText(statements(api))).not.toContain("kms:");
    expect(asText(statements(messaging))).not.toContain("health/data-key");
  });

  it("creates no parameter and no customer-managed key", () => {
    for (const template of [api, messaging]) {
      template.resourceCountIs("AWS::SSM::Parameter", 0);
      template.resourceCountIs("AWS::KMS::Key", 0);
    }
  });
});
