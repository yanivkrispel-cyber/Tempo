import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";

function alarmNames(stage: typeof dev): string[] {
  return stage.node
    .findAll()
    .filter(Stack.isStack)
    .flatMap((stack) => Object.values(Template.fromStack(stack).findResources("AWS::CloudWatch::Alarm")))
    .map((alarm) => alarm.Properties.AlarmName as string)
    .sort();
}

describe("Alarm budget (ADR-0012 amendment, ADR-0021)", () => {
  it("development has no CloudWatch alarms", () => {
    // The ten free alarms are pooled across the Organization; development
    // would otherwise use them up and turn production's alarms into a cost.
    expect(alarmNames(dev)).toEqual([]);
  });

  it("production has exactly the ten alarms ADR-0012 lists, all free", () => {
    expect(alarmNames(prod)).toEqual(
      [
        "cloudfront-5xx-rate",
        "lambda-errors",
        "lambda-throttles",
        "api-duration-p99",
        "work-dlq-messages",
        "work-oldest-message-age",
        "database-capacity",
        "ses-bounce-rate",
        "ses-complaint-rate",
        "canary-failure"
      ]
        .map((name) => `tempo-prod-${name}`)
        .sort()
    );
  });
});
