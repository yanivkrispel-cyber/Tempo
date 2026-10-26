import { expect, test, type Page, type Request } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

interface Call {
  path: string;
  start: number;
  end: number;
}

/** Records every API call the page makes, with when it started and ended (epoch ms). */
function recordCalls(page: Page): { calls: Call[]; sessionAnswer: Promise<unknown> } {
  const calls: Call[] = [];
  page.on("requestfinished", (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/v1/")) return;
    const timing = request.timing();
    calls.push({
      path: `${request.method()} ${url.pathname}`,
      start: timing.startTime,
      end: timing.startTime + timing.responseEnd,
    });
  });
  const sessionAnswer = page
    .waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/session")
    .then((response) => response.json());
  return { calls, sessionAnswer };
}

/** How many calls deep the page went: a call is one deeper than the deepest call that ended before it started. */
function depthOf(calls: Call[]): number {
  const depth = new Map<Call, number>();
  for (const call of [...calls].sort((a, b) => a.start - b.start)) {
    const before = calls.filter((other) => other !== call && other.end <= call.start).map((o) => depth.get(o) ?? 1);
    depth.set(call, 1 + Math.max(0, ...before));
  }
  return Math.max(0, ...depth.values());
}

/** The session's own membership in the e2e studio carries its time zone from #524 on; older APIs leave it out. */
function sessionCarriesTimeZone(answer: unknown): boolean {
  const memberships = (answer as { memberships?: { organization: { slug: string; timeZone?: string } }[] }).memberships;
  return Boolean(memberships?.find((m) => m.organization.slug === studioSlug)?.organization.timeZone);
}

// Board #523, O3 (T-3): today and reports start their reads together, right after `/session`, without a round for
// the studio's record (its time zone now comes with the session).
for (const [screen, route, heading] of [
  ["today", "today", /^(בוקר טוב|צהריים טובים|ערב טוב|לילה טוב)/],
  ["reports", "reports", "דוחות"],
] as const) {
  test(`console ${screen}: every read starts right after /session, two calls deep`, async ({ page }, testInfo) => {
    const { calls, sessionAnswer } = recordCalls(page);
    await page.goto(`/o/${studioSlug}/${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    test.skip(!sessionCarriesTimeZone(await sessionAnswer), "the API on dev doesn't carry the time zone yet (#524)");
    await page.waitForLoadState("networkidle");

    const studioRecord = new RegExp(`^GET /api/v1/organizations/[0-9a-f-]{36}$`);
    expect(calls.map((call) => call.path).filter((path) => studioRecord.test(path))).toEqual([]);
    // The console renders from the stored session while `/session` refreshes it, so the reads may even overlap it;
    // what counts is that none of them waits for another.
    const reads = calls.filter((call) => call.path !== "POST /api/v1/session");
    expect(reads.length).toBeGreaterThan(0);
    expect(depthOf(reads)).toBe(1);
    expect(depthOf(calls)).toBeLessThanOrEqual(2);
    await expectNoSeriousA11yViolations(page, testInfo, `console ${screen}`);
  });
}
