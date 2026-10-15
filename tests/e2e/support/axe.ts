import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** WCAG 2.2 A and AA, the level docs/AGENTS.md asks for. */
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The Layer-1 gate: these impacts fail the test. Minor and moderate ones are attached and annotated only. */
const blocking = new Set(["serious", "critical"]);

/**
 * Runs axe on the page as it is now (optionally only inside `include`), attaches the full result to the report, and
 * fails the test on any serious or critical violation, listing rule, impact and the offending selectors.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  testInfo: TestInfo,
  screen: string,
  include?: string,
  /** A known product bug: the violations are annotated on the report instead of failing the test. */
  knownIssue?: string,
): Promise<void> {
  // Let loading skeletons settle so axe sees the real screen.
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
  // Audit the resting screen, not a hover state: after a click the pointer stays on the button (or on the button the
  // next dialog draws in the same place), and the sage hover fill is solid, so axe measures the owner-accepted
  // cream-on-sage pair there (docs/claude-memory/design-system.md) while it skips the same pair on the resting gradient.
  await page.mouse.move(0, 0);

  let builder = new AxeBuilder({ page }).withTags(tags);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();

  await testInfo.attach(`axe-${screen}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  for (const violation of results.violations.filter((v) => !blocking.has(v.impact ?? ""))) {
    testInfo.annotations.push({
      type: `axe ${violation.impact ?? "unknown"}`,
      description: `${screen}: ${violation.id} (${violation.nodes.length} node(s)) ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    });
  }

  const serious = results.violations.filter((violation) => blocking.has(violation.impact ?? ""));
  const lines = serious.map(
    (violation) =>
      `[${violation.impact}] ${violation.id}: ${violation.help}\n` +
      violation.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
  );
  if (knownIssue && serious.length > 0) {
    testInfo.annotations.push({ type: "known-a11y-bug", description: `${screen}: ${knownIssue}` });
    return;
  }
  // Soft, so one screen's findings do not hide the next screen's: the test still fails at the end.
  expect
    .soft(
      serious.map((violation) => violation.id),
      `axe found serious or critical violations on ${screen}:\n${lines.join("\n")}`,
    )
    .toEqual([]);
}
