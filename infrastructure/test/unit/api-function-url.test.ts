import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import cdkJson from "../../cdk.json";
import developmentConfig from "../../config/development";
import { validateEnvironmentConfig } from "../../config/environment-config";
import { TempoStage } from "../../lib/tempo-stage";
import { dev } from "./helpers/synth";

function invokePermissions(stage: TempoStage) {
  const api = stage.node.findChild("Api");
  if (!Stack.isStack(api)) throw new Error("Api is not a Stack");
  return Object.values(Template.fromStack(api).findResources("AWS::Lambda::Permission")).filter(
    (permission) => permission.Properties.Principal === "cloudfront.amazonaws.com"
  );
}

const sourceArns = (stage: TempoStage) => invokePermissions(stage).map((p) => JSON.stringify(p.Properties.SourceArn));

describe("who may invoke the API's Function URL (#124 item 8)", () => {
  it("without the edge distribution's id, any distribution of the account (the circular reference)", () => {
    const arns = sourceArns(dev);
    expect(arns).toHaveLength(2);
    for (const arn of arns) expect(arn).toContain(":distribution/*");
  });

  it("with the id in the config, only that distribution, on both permissions", () => {
    const app = new App({ context: cdkJson.context });
    const stage = new TempoStage(app, "TestTempoDevPinnedEdge", {
      config: { ...developmentConfig, edgeDistributionId: "E2EXAMPLE12345" },
      buildVersion: "test-sha",
    });
    app.synth();

    const arns = sourceArns(stage);
    expect(arns).toHaveLength(2);
    for (const arn of arns) {
      expect(arn).toContain(":distribution/E2EXAMPLE12345");
      expect(arn).not.toContain("*");
    }
  });

  it("refuses an id that is not a distribution id", () => {
    expect(() => validateEnvironmentConfig({ ...developmentConfig, edgeDistributionId: "*" })).toThrow(
      /edgeDistributionId/
    );
    expect(() =>
      validateEnvironmentConfig({ ...developmentConfig, edgeDistributionId: "E2EXAMPLE12345" })
    ).not.toThrow();
  });
});
