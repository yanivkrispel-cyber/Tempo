import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, Stack, Validations } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import cdkJson from "../../cdk.json";
import developmentConfig from "../../config/development";
import productionConfig from "../../config/production";
import { TempoStage } from "../../lib/tempo-stage";
import { NAG_ACKNOWLEDGMENTS } from "./helpers/nag-suppressions";

interface Violation {
  readonly ruleName: string;
  readonly violatingResources: { readonly constructPath?: string; readonly resourceLogicalId?: string }[];
}

/**
 * cdk-nag AwsSolutions over dev (edge on, so the edge stack is checked) and
 * prod (ADR-0025, Layer 1). Its own app: the validation plugin reads the whole
 * tree, so it must not share the stages of helpers/synth.ts. cdk-nag 3 reports
 * through CDK's policy validation: synth throws on a finding and writes
 * policy-validation-report.json (with the validationReportJson flag), which
 * this test reads.
 */
/**
 * A queue without SSL enforcement or a dead-letter queue, put in every stack of both stages: cdk-nag must report it
 * in each one, which proves the gate walks every stack (#208 U3: until aws-cdk-lib 2.273 it did not see the dev
 * Canary stack). Its findings are left out of the "no unacknowledged finding" check.
 */
const COVERAGE_PROBE = "NagCoverageProbe";

function validate(): { violations: Violation[]; unmatched: string[]; stacks: string[] } {
  const outdir = mkdtempSync(join(tmpdir(), "tempo-nag-"));
  const app = new App({ context: { ...cdkJson.context, "@aws-cdk/core:validationReportJson": true }, outdir });
  const devWithEdge = new TempoStage(app, "NagTempoDev", {
    config: {
      ...developmentConfig,
      featureFlags: { ...developmentConfig.featureFlags, enableFrontendHosting: true, enableWaf: true }
    },
    buildVersion: "test-sha"
  });
  const prod = new TempoStage(app, "NagTempoProd", { config: productionConfig, buildVersion: "test-sha" });
  const stacks = [devWithEdge, prod].flatMap((stage) => stage.node.findAll().filter(Stack.isStack));
  for (const stack of stacks) new Queue(stack, COVERAGE_PROBE);
  const unmatched = new Set(NAG_ACKNOWLEDGMENTS.flatMap((a) => a.paths));
  for (const stage of [devWithEdge, prod]) {
    for (const { id, reason, paths } of NAG_ACKNOWLEDGMENTS) {
      for (const path of paths) {
        const construct = stage.node.findAll().find((c) => c.node.path === `${stage.node.path}/${path}`);
        if (construct) {
          // Validations.acknowledge() rejects ids with a second '::', which every IAM finding
          // has (`IAM5[Resource::*]`); cdk-nag reads the raw rule id from this metadata.
          construct.node.addMetadata(Validations.ACKNOWLEDGED_RULES_METADATA_KEY, { [id]: reason });
          unmatched.delete(path);
        }
      }
    }
  }
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));

  let violations: Violation[] = [];
  try {
    app.synth();
  } catch {
    const report = JSON.parse(readFileSync(join(outdir, "policy-validation-report.json"), "utf8"));
    violations = report.pluginReports.flatMap((plugin: { violations: Violation[] }) => plugin.violations);
  }
  return { violations, unmatched: [...unmatched], stacks: stacks.map((stack) => stack.node.path) };
}

const result = validate();

describe("cdk-nag AwsSolutions (ADR-0025)", () => {
  it("dev and prod have no unacknowledged finding", () => {
    const findings = new Set(
      result.violations.flatMap((v) => v.violatingResources.map((r) => `${v.ruleName} at ${r.constructPath ?? r.resourceLogicalId}`))
    );

    expect([...findings].filter((finding) => !finding.includes(`/${COVERAGE_PROBE}/`))).toEqual([]);
  });

  it("checks every stack of both stages", () => {
    const probe = `/${COVERAGE_PROBE}/`;
    const probed = new Set(
      result.violations.flatMap((v) =>
        v.violatingResources
          .map((r) => r.constructPath ?? "")
          .filter((path) => path.includes(probe))
          .map((path) => path.slice(0, path.indexOf(probe)))
      )
    );

    expect(result.stacks).toContain("NagTempoDev/Canary");
    expect(result.stacks.filter((stack) => !probed.has(stack))).toEqual([]);
  });

  it("every acknowledged path still exists", () => {
    expect(result.unmatched).toEqual([]);
  });

  it("every acknowledgment carries a reason", () => {
    for (const acknowledgment of NAG_ACKNOWLEDGMENTS) {
      expect(acknowledgment.reason.length, acknowledgment.id).toBeGreaterThanOrEqual(20);
    }
  });
});
