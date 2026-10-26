import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

/** The session's own membership in the e2e studio carries its time zone from #524 on; older APIs leave it out. */
function sessionCarriesTimeZone(answer: unknown): boolean {
  const memberships = (answer as { memberships?: { organization: { slug: string; timeZone?: string } }[] }).memberships;
  return Boolean(memberships?.find((m) => m.organization.slug === studioSlug)?.organization.timeZone);
}

// Board #530, O1: the member app takes the studio's time zone from the session, like the console since #526, so
// home, book, bookings and profile never read the studio's record for it.
test("client-web: no screen reads the studio record for its time zone", async ({ page }, testInfo) => {
  const studioRecord = /^\/api\/v1\/organizations\/[0-9a-f-]{36}$/;
  const reads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && studioRecord.test(path)) reads.push(path);
  });
  const session = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/session") && response.request().method() === "POST",
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  test.skip(!sessionCarriesTimeZone(await (await session).json()), "the API doesn't carry the time zone yet (#524)");
  for (const [path, heading] of [
    ["/book", "מערכת שיעורים"],
    ["/bookings", "ההזמנות שלי"],
    ["/profile", null],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, ...(heading ? { name: heading } : {}) })).toBeVisible();
    await page.waitForLoadState("networkidle");
  }

  expect(reads).toEqual([]);
  await expectNoSeriousA11yViolations(page, testInfo, "client-web profile");
});
