import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { NEON_USAGE_SOURCE } from "../../lib/data/database-stack";
import { dev, prod } from "./helpers/synth";

function databaseTemplate(stage: typeof dev) {
  const child = stage.node.findChild("Database");
  if (!Stack.isStack(child)) throw new Error("Expected a Database stack");
  return Template.fromStack(child);
}

function usageFunctionEnvironment(stage: typeof dev): Record<string, unknown> {
  const functions = Object.values(databaseTemplate(stage).findResources("AWS::Lambda::Function")).filter(
    (f) => f.Properties.FunctionName === `tempo-${stage === dev ? "dev" : "prod"}-neon-usage`
  );
  expect(functions).toHaveLength(1);
  return functions[0].Properties.Environment.Variables;
}

describe("Neon usage warning in development (#97, R-4)", () => {
  it("development warns through the canary's topic once a period, with no alarm", () => {
    const variables = usageFunctionEnvironment(dev);
    expect(variables.WARN_PERCENT).toBe("70");
    expect(variables.WARN_STATE_PARAMETER).toBe("/tempo/dev/neon/usage-warning");
    expect(JSON.stringify(variables.WARN_TOPIC_ARN)).toContain(":tempo-dev-api-canary");
    const template = databaseTemplate(dev);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    template.resourceCountIs("AWS::SNS::Topic", 0);
    template.hasResourceProperties("AWS::SSM::Parameter", { Name: "/tempo/dev/neon/usage-warning", Type: "String" });
  });

  it("production keeps its alarm and gets no email path from the function", () => {
    const variables = usageFunctionEnvironment(prod);
    expect(variables.WARN_TOPIC_ARN).toBeUndefined();
    expect(variables.WARN_STATE_PARAMETER).toBeUndefined();
  });

  it("the function may publish only to the canary topic and write only its own state", () => {
    const template = databaseTemplate(dev);
    const [stateId] = Object.keys(
      template.findResources("AWS::SSM::Parameter", { Properties: { Name: "/tempo/dev/neon/usage-warning" } })
    );
    expect(stateId).toBeDefined();
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>
    );
    const publish = statements.filter((s) => [s.Action].flat().includes("sns:Publish"));
    expect(publish).toHaveLength(1);
    expect(JSON.stringify(publish[0].Resource)).toContain(":tempo-dev-api-canary");
    const put = statements.filter((s) => [s.Action].flat().includes("ssm:PutParameter"));
    expect(put).toHaveLength(1);
    expect(JSON.stringify(put[0].Resource)).toContain(`{"Ref":"${stateId}"}`);
  });
});

// The inline function, run against fakes: the Neon API, SSM, CloudWatch and SNS.
type Sent = { client: string; command: string; input: Record<string, unknown> };

async function runUsageCheck(options: {
  computeSeconds: number;
  periodEnd: string;
  warnedPeriodEnd?: string | null;
  warn?: boolean;
}) {
  const sent: Sent[] = [];
  let state = JSON.stringify({ warnedPeriodEnd: options.warnedPeriodEnd ?? null });
  const client = (name: string) =>
    class {
      async send(command: { name: string; input: Record<string, unknown> }) {
        sent.push({ client: name, command: command.name, input: command.input });
        if (command.name === "GetParameter") {
          return { Parameter: { Value: command.input.Name === "/state" ? state : "fake-key" } };
        }
        if (command.name === "PutParameter") state = command.input.Value as string;
        return {};
      }
    };
  const command = (name: string) =>
    class {
      name = name;
      constructor(public input: Record<string, unknown>) {}
    };
  const modules: Record<string, Record<string, unknown>> = {
    "@aws-sdk/client-ssm": {
      SSMClient: client("ssm"),
      GetParameterCommand: command("GetParameter"),
      PutParameterCommand: command("PutParameter")
    },
    "@aws-sdk/client-cloudwatch": { CloudWatchClient: client("cloudwatch"), PutMetricDataCommand: command("PutMetricData") },
    "@aws-sdk/client-sns": { SNSClient: client("sns"), PublishCommand: command("Publish") }
  };
  const env: Record<string, string> = {
    API_KEY_PARAMETER: "/key",
    NEON_PROJECT_ID: "p",
    ENVIRONMENT: "dev",
    LIMIT_COMPUTE_SECONDS: String(100 * 3600),
    LIMIT_STORAGE_BYTES: String(1024 ** 3),
    LIMIT_EGRESS_BYTES: String(5 * 1024 ** 3),
    ...(options.warn === false ? {} : { WARN_PERCENT: "70", WARN_TOPIC_ARN: "arn:topic", WARN_STATE_PARAMETER: "/state" })
  };
  const fetch = async () => ({
    ok: true,
    json: async () => ({
      project: {
        compute_time_seconds: options.computeSeconds,
        synthetic_storage_size: 0,
        data_transfer_bytes: 0,
        consumption_period_end: options.periodEnd
      }
    })
  });
  const exports: { handler?: () => Promise<void> } = {};
  new Function("require", "exports", "process", "fetch", "console", NEON_USAGE_SOURCE)(
    (name: string) => modules[name],
    exports,
    { env },
    fetch,
    { log: () => undefined }
  );
  await exports.handler!();
  return { sent, state: JSON.parse(state) as { warnedPeriodEnd: string | null } };
}

const hours = (h: number) => h * 3600;

describe("Neon usage function's warning", () => {
  it("publishes the metric and stays quiet under 70%", async () => {
    const { sent } = await runUsageCheck({ computeSeconds: hours(69), periodEnd: "2026-11-14T00:00:00Z" });
    expect(sent.map((s) => s.command)).toContain("PutMetricData");
    expect(sent.map((s) => s.command)).not.toContain("Publish");
  });

  it("emails once at 70% and records the period", async () => {
    const { sent, state } = await runUsageCheck({ computeSeconds: hours(72), periodEnd: "2026-11-14T00:00:00Z" });
    const publish = sent.filter((s) => s.command === "Publish");
    expect(publish).toHaveLength(1);
    expect(publish[0].input.TopicArn).toBe("arn:topic");
    expect(publish[0].input.Subject).toBe("[tempo-dev] Neon at 72% of a Free plan limit");
    expect(publish[0].input.Message).toContain("compute 72%");
    expect(state.warnedPeriodEnd).toBe("2026-11-14T00:00:00Z");
    // The metric goes out before the email, so a failed email never loses it.
    expect(sent.findIndex((s) => s.command === "PutMetricData")).toBeLessThan(
      sent.findIndex((s) => s.command === "Publish")
    );
  });

  it("does not email again in the same period, and does in the next one", async () => {
    const same = await runUsageCheck({
      computeSeconds: hours(90),
      periodEnd: "2026-11-14T00:00:00Z",
      warnedPeriodEnd: "2026-11-14T00:00:00Z"
    });
    expect(same.sent.map((s) => s.command)).not.toContain("Publish");
    const next = await runUsageCheck({
      computeSeconds: hours(75),
      periodEnd: "2026-12-14T00:00:00Z",
      warnedPeriodEnd: "2026-11-14T00:00:00Z"
    });
    expect(next.sent.map((s) => s.command)).toContain("Publish");
  });

  it("never emails where no warning is configured (production has its alarm)", async () => {
    const { sent } = await runUsageCheck({ computeSeconds: hours(95), periodEnd: "2026-11-14T00:00:00Z", warn: false });
    expect(sent.map((s) => s.client)).not.toContain("sns");
    expect(sent.filter((s) => s.command === "GetParameter")).toHaveLength(1);
  });
});
