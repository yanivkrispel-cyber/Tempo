import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

const asText = (value: unknown) => JSON.stringify(value);

describe("the support contact (board #584, PL-4)", () => {
  const child = dev.node.findChild("Api");
  if (!Stack.isStack(child)) throw new Error("Api is not a Stack");
  const api = Template.fromStack(child);

  it("names the parameter for the API and grants reading that one name only", () => {
    const fn = Object.values(api.findResources("AWS::Lambda::Function")).find((f) =>
      String(f.Properties.FunctionName).endsWith("-api")
    );
    expect(fn?.Properties.Environment.Variables.SUPPORT_CONTACT_PARAMETER).toBe("/tempo/dev/support/contact");

    const reads = Object.values(api.findResources("AWS::IAM::Policy"))
      .flatMap((p) => p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[])
      .filter((s) => asText(s.Resource).includes("support/contact"));
    expect(reads).toHaveLength(1);
    expect(asText(reads[0].Action)).toContain("ssm:GetParameter");
    expect(asText(reads[0].Action)).not.toContain("ssm:PutParameter");
  });

  it("creates no parameter: a person writes it, and the deploy never waits for it", () => {
    api.resourceCountIs("AWS::SSM::Parameter", 0);
  });
});
