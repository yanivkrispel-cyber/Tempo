import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";

function alarmCount(stage: typeof dev): number {
  return stage.node
    .findAll()
    .filter(Stack.isStack)
    .reduce((total, stack) => total + Object.keys(Template.fromStack(stack).findResources("AWS::CloudWatch::Alarm")).length, 0);
}

describe("Alarm budget (ADR-0012 amendment, ADR-0021)", () => {
  it("development has no CloudWatch alarms", () => {
    // The ten free alarms are pooled across the Organization; development
    // would otherwise use them up and turn production's alarms into a cost.
    expect(alarmCount(dev)).toBe(0);
  });

  it("production keeps its alarms", () => {
    // Step 8 replaces this set with the ten alarms ADR-0012 lists.
    expect(alarmCount(prod)).toBeGreaterThan(0);
  });
});
