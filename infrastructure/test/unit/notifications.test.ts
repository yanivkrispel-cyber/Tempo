import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

function stackTemplate(childId: string) {
  const child = dev.node.findChild(childId);
  if (!Stack.isStack(child)) throw new Error(`${childId} is not a Stack`);
  return Template.fromStack(child);
}

function functionNamed(template: Template, suffix: string) {
  const match = Object.values(template.findResources("AWS::Lambda::Function")).find((fn) =>
    String(fn.Properties.FunctionName).endsWith(suffix)
  );
  if (match === undefined) throw new Error(`no function ending ${suffix}`);
  return match.Properties.Environment.Variables as Record<string, unknown>;
}

function statements(template: Template) {
  return Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy.Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[]
  );
}

const asText = (value: unknown) => JSON.stringify(value);

describe("web push and reminders (docs/30 section 8)", () => {
  const api = stackTemplate("Api");
  const messaging = stackTemplate("Messaging");

  it("the API signals the work queue by name and reads only the public VAPID key", () => {
    const env = functionNamed(api, "-api");
    expect(asText(env.WORK_QUEUE_URL)).toContain("/tempo-dev-work");
    expect(env.VAPID_PUBLIC_KEY_PARAMETER).toBe("/tempo/dev/push/vapid-public-key");
    expect(env.VAPID_PRIVATE_KEY_PARAMETER).toBeUndefined();

    const send = statements(api).filter((s) => asText(s.Action).includes("sqs:SendMessage"));
    expect(send).toHaveLength(1);
    expect(asText(send[0].Resource)).toContain(":tempo-dev-work");
    expect(asText(statements(api))).not.toContain("vapid-private-key");
  });

  it("the worker reads both keys and signs with an https contact", () => {
    const env = functionNamed(messaging, "-worker-outbox");
    expect(env.VAPID_PUBLIC_KEY_PARAMETER).toBe("/tempo/dev/push/vapid-public-key");
    expect(env.VAPID_PRIVATE_KEY_PARAMETER).toBe("/tempo/dev/push/vapid-private-key");
    expect(String(env.VAPID_SUBJECT)).toMatch(/^https:\/\//);

    const reads = asText(statements(messaging).filter((s) => asText(s.Action).includes("ssm:GetParameter")));
    expect(reads).toContain("push/vapid-public-key");
    expect(reads).toContain("push/vapid-private-key");
  });

  it("sends reminders hourly in the daytime only, without retries", () => {
    const schedules = Object.values(messaging.findResources("AWS::Scheduler::Schedule")).filter((schedule) =>
      asText(schedule.Properties.Target.Input).includes("notifications.reminders_hourly")
    );
    expect(schedules).toHaveLength(1);
    expect(schedules[0].Properties.ScheduleExpression).toBe("cron(0 7-21 * * ? *)");
    expect(schedules[0].Properties.ScheduleExpressionTimezone).toBe("Asia/Jerusalem");
    expect(schedules[0].Properties.Target.RetryPolicy.MaximumRetryAttempts).toBe(0);
  });

  it("creates no key, parameter or paid resource for push", () => {
    for (const template of [api, messaging]) {
      template.resourceCountIs("AWS::SSM::Parameter", 0);
      template.resourceCountIs("AWS::KMS::Key", 0);
    }
  });
});
