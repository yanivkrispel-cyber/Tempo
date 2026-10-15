import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { nextState } from "../../lambda/canary/state";
import { dev, prod } from "./helpers/synth";

function canaryStack(stage: typeof dev): Stack | undefined {
  const child = stage.node.tryFindChild("Canary");
  return child && Stack.isStack(child) ? child : undefined;
}

describe("Development canary (Wave Q, Q10)", () => {
  const stack = canaryStack(dev);
  if (!stack) throw new Error("dev has no Canary stack");
  const template = Template.fromStack(stack);

  it("exists in development only", () => {
    expect(canaryStack(prod)).toBeUndefined();
  });

  it("checks health every 5 minutes and signs in every hour", () => {
    const schedules = Object.values(template.findResources("AWS::Scheduler::Schedule")).map((s) => ({
      expression: s.Properties.ScheduleExpression,
      input: JSON.parse(s.Properties.Target.Input)
    }));
    expect(schedules).toEqual(
      expect.arrayContaining([
        { expression: "rate(5 minutes)", input: { mode: "health" } },
        { expression: "rate(1 hour)", input: { mode: "deep" } }
      ])
    );
    expect(schedules).toHaveLength(2);
  });

  it("alerts by email through SNS, with no CloudWatch alarm and no custom metric", () => {
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email" });
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).not.toContain("cloudwatch:PutMetricData");
  });

  it("grants only what the checks use, never on every resource", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>
    );
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    expect(actions).toContain("cognito-idp:AdminInitiateAuth");
    expect(actions).toContain("sns:Publish");
    expect(actions).toContain("ssm:PutParameter");
    for (const statement of statements) {
      if (JSON.stringify(statement.Action).includes("xray:")) continue; // active tracing: no resource-level permissions
      expect(statement.Resource, JSON.stringify(statement.Action)).not.toEqual("*");
    }
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "cognito-idp:AdminInitiateAuth", Resource: Match.objectLike({ "Fn::ImportValue": Match.anyValue() }) })
        ])
      }
    });
  });
});

describe("Two of three failures (canary state)", () => {
  const at = "2026-10-15T15:00:00.000Z";

  it("stays quiet on one failure", () => {
    const first = nextState(undefined, false, at);
    expect(first).toMatchObject({ changed: false, failures: 1, state: { alerting: false } });
  });

  it("alerts on the second failure in three, once", () => {
    const one = nextState(undefined, false, at).state;
    const two = nextState(one, true, at).state;
    const three = nextState(two, false, at);
    expect(three).toMatchObject({ changed: true, failures: 2, state: { alerting: true, results: [false, true, false] } });
    expect(nextState(three.state, false, at)).toMatchObject({ changed: false, state: { alerting: true } });
  });

  it("recovers when fewer than two of the last three failed", () => {
    let state = nextState(nextState(undefined, false, at).state, false, at).state;
    state = nextState(state, true, at).state;
    const recovered = nextState(state, true, "2026-10-15T15:10:00.000Z");
    expect(recovered).toMatchObject({ changed: true, failures: 1, state: { alerting: false, since: "2026-10-15T15:10:00.000Z" } });
  });
});
