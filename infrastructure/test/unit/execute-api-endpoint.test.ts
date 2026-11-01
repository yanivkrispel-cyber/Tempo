import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import type { TempoStage } from "../../lib/tempo-stage";
import { dev, devWithEdge, prod } from "./helpers/synth";

function httpApi(stage: TempoStage) {
  const api = stage.node.findChild("Api");
  if (!Stack.isStack(api)) throw new Error("Api is not a Stack");
  const [resource] = Object.values(Template.fromStack(api).findResources("AWS::ApiGatewayV2::Api"));
  return resource.Properties;
}

const childIds = (stage: TempoStage) => stage.node.children.map((child) => child.node.id);

describe("the execute-api endpoint is off whenever an edge fronts the API (#122)", () => {
  it("is off in production, so no caller can skip the WAF on the distribution", () => {
    expect(httpApi(prod).DisableExecuteApiEndpoint).toBe(true);
  });

  it("is off on dev with the edge switched on", () => {
    expect(httpApi(devWithEdge).DisableExecuteApiEndpoint).toBe(true);
  });

  it("stays on in dev without the edge, where the apps and the smoke test call it", () => {
    expect(httpApi(dev).DisableExecuteApiEndpoint).not.toBe(true);
  });

  it("the dev canary, which calls execute-api, is built only without the edge; the edge stack has its own", () => {
    expect(childIds(dev)).toContain("Canary");
    expect(childIds(devWithEdge)).not.toContain("Canary");
    expect(childIds(devWithEdge)).toContain("Edge");
  });
});
