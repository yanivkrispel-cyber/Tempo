import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";

function observabilityStack(stage: typeof dev): Stack {
  const child = stage.node.tryFindChild("Observability");
  if (!child || !Stack.isStack(child)) throw new Error("stage has no Observability stack");
  return child;
}

/** The dashboard body is a Fn::Join of strings and references; flattened, its text is searchable. */
function dashboardBody(stage: typeof dev): string {
  const template = Template.fromStack(observabilityStack(stage));
  const dashboards = Object.values(template.findResources("AWS::CloudWatch::Dashboard"));
  expect(dashboards).toHaveLength(1);
  return JSON.stringify(dashboards[0].Properties.DashboardBody);
}

describe("Dashboard (night board #136, B3)", () => {
  it("development shows the queue, the concurrency quota, the daily jobs, the canary and Neon, with no alarm", () => {
    const body = dashboardBody(dev);
    // Queue names arrive as cross-stack imports, so the export names stand in for them.
    for (const expected of [
      "WorkQueueDeadLetterQueue",
      "ApproximateNumberOfMessagesNotVisible",
      "ApproximateAgeOfOldestMessage",
      "ConcurrentExecutions",
      "AWS/Scheduler",
      "tempo-dev-neon-usage",
      "tempo-dev-api-canary",
      "NeonFreeLimitPercent"
    ]) {
      expect(body).toContain(expected);
    }
    Template.fromStack(observabilityStack(dev)).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("production has the same page without the development canary", () => {
    const body = dashboardBody(prod);
    expect(body).toContain("TestTempoProd-Messaging");
    expect(body).toContain("WorkQueueDeadLetterQueue");
    expect(body).toContain("tempo-prod-neon-usage");
    expect(body).not.toContain("api-canary");
  });

  it("stays inside the free tier: at most fifty metrics on the one dashboard", () => {
    const body = dashboardBody(dev);
    // Every metric line in a dashboard body starts with its namespace in an array: ["AWS/Lambda", ...].
    const metricLines = body.match(/\[\\"(AWS\/[A-Za-z0-9]+|Tempo\/[A-Za-z]+)\\"/g) ?? [];
    expect(metricLines.length).toBeGreaterThan(10);
    expect(metricLines.length).toBeLessThanOrEqual(50);
  });
});
