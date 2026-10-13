import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

describe("Cost baseline: $1 budget that alerts on the first cent (ADR-0020, ADR-0021)", () => {
  const child = dev.node.findChild("AccountBaseline");
  if (!Stack.isStack(child)) throw new Error("AccountBaseline is not a Stack");
  const template = Template.fromStack(child);

  it("budgets $1 a month", () => {
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 1, Unit: "USD" }, TimeUnit: "MONTHLY", BudgetType: "COST" })
    });
  });

  it("alerts on the first cent of actual spend and on a forecast above the budget", () => {
    const budget = Object.values(template.findResources("AWS::Budgets::Budget"))[0];
    const notifications = budget.Properties.NotificationsWithSubscribers.map(
      (n: { Notification: Record<string, unknown>; Subscribers: Array<{ Address: string }> }) => ({
        ...n.Notification,
        to: n.Subscribers.map((s) => s.Address)
      })
    );

    expect(notifications).toEqual(
      expect.arrayContaining([
        // 1% of the $1 budget is the first cent.
        expect.objectContaining({ NotificationType: "ACTUAL", Threshold: 1, ThresholdType: "PERCENTAGE" }),
        expect.objectContaining({ NotificationType: "FORECASTED", Threshold: 100, ThresholdType: "PERCENTAGE" })
      ])
    );
    for (const n of notifications) {
      expect(n.to).toEqual(["yaniv.krispel+tempo-app@gmail.com"]);
    }
  });

  it("subscribes to cost anomalies of $1 or more", () => {
    const subscription = Object.values(template.findResources("AWS::CE::AnomalySubscription"))[0];
    expect(JSON.parse(subscription.Properties.ThresholdExpression)).toEqual({
      Dimensions: { Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE", Values: ["1"], MatchOptions: ["GREATER_THAN_OR_EQUAL"] }
    });
  });

  it("subscribes to the management account's existing AWS services monitor instead of creating a second one", () => {
    template.resourceCountIs("AWS::CE::AnomalyMonitor", 0);
    const subscription = Object.values(template.findResources("AWS::CE::AnomalySubscription"))[0];
    expect(subscription.Properties.MonitorArnList).toEqual([
      "arn:aws:ce::687239340846:anomalymonitor/2426a559-1df4-4d63-9375-c8fe4ca7a971"
    ]);
  });
});
