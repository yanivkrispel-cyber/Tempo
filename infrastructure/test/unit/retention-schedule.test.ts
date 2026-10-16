import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

function messagingTemplate(): Template {
  const child = dev.node.tryFindChild("Messaging");
  if (!child || !Stack.isStack(child)) throw new Error("dev has no Messaging stack");
  return Template.fromStack(child);
}

describe("The daily retention job (night board #136, B4)", () => {
  it("sends a retention.daily message to the work queue once a night, after the scheduling job", () => {
    const schedules = Object.values(messagingTemplate().findResources("AWS::Scheduler::Schedule"));
    const retention = schedules.find((s) => s.Properties.Name === "tempo-dev-retention-daily");
    expect(retention).toBeDefined();
    expect(retention!.Properties.ScheduleExpression).toBe("cron(45 3 * * ? *)");
    expect(retention!.Properties.ScheduleExpressionTimezone).toBe("Asia/Jerusalem");
    expect(retention!.Properties.Target.Arn).toBe("arn:aws:scheduler:::aws-sdk:sqs:sendMessage");
    expect(JSON.stringify(retention!.Properties.Target.Input)).toContain("retention.daily");
    // One schedule per message: the three daily ones (tripwire, scheduling, retention) and the hourly reminders.
    expect(schedules).toHaveLength(4);
  });
});
