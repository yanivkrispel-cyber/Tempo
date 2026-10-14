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

  // ADR-0022 removed the Aurora capacity alarm. The tenth alarm, Neon usage at
  // 70% of a Free plan limit, arrives with the scheduled usage check.
  it("production has the alarms ADR-0012 lists, all free", () => {
    expect(alarmNames(prod)).toEqual(
      [
        "cloudfront-5xx-rate",
        "lambda-errors",
        "lambda-throttles",
        "api-duration-p99",
        "work-dlq-messages",
        "work-oldest-message-age",
        "ses-bounce-rate",
        "ses-complaint-rate",
        "canary-failure"
      ]
        .map((name) => `tempo-prod-${name}`)
        .sort()
    );
  });
});
