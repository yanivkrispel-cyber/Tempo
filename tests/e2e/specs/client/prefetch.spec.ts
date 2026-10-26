import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// Board #530, O2 (U-5): once home has painted, the tabs' screens load on idle, so the first tap on a tab doesn't wait
// for its chunk. The inbox isn't checked: home already imports it. Works on the dev server (one module per screen)
// and on a build (one chunk per screen, named after it).
const tabScreens = ["BookScreen", "BookingsScreen", "ProfileScreen"] as const;

test("client-web: the tabs' screens load after home paints, and a tap doesn't fetch them again", async ({
  page,
}, testInfo) => {
  const startedAt = new Map<string, number>();
  let homeLoadedAt = Number.POSITIVE_INFINITY;
  page.on("request", (request) => {
    const file = new URL(request.url()).pathname.split("/").pop() ?? "";
    for (const screen of tabScreens) if (file.startsWith(screen)) startedAt.set(screen, Date.now());
  });
  page.on("requestfinished", (request) => {
    const file = new URL(request.url()).pathname.split("/").pop() ?? "";
    if (file.startsWith("HomeScreen")) homeLoadedAt = Math.min(homeLoadedAt, Date.now());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => tabScreens.filter((screen) => startedAt.has(screen))).toEqual([...tabScreens]);
  for (const screen of tabScreens) expect(startedAt.get(screen)!).toBeGreaterThan(homeLoadedAt);

  const before = new Map(startedAt);
  await page.getByRole("navigation").getByRole("link", { name: "מערכת" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "מערכת שיעורים" })).toBeVisible();
  expect(startedAt.get("BookScreen")).toBe(before.get("BookScreen"));
  await expectNoSeriousA11yViolations(page, testInfo, "client-web book after the prefetch");
});
