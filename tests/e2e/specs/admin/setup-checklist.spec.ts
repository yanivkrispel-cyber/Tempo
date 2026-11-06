import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// The smoke studio is fully set up, so the checklist would hide. The page's own reads go to dev as usual and the
// browser then empties some of the lists in the answer, which shows the checklist as a new studio would see it.
// Nothing is written to dev.
type Stage = "new" | "half";

const emptied: Record<Stage, string[]> = {
  new: ["rooms", "class-types", "schedule-templates", "pass-products", "people", "sessions"],
  half: ["schedule-templates", "people", "sessions"],
};

async function showAs(page: Page, stage: Stage) {
  await page.route(/\/api\/v1\/organizations\/[^/]+(\/[a-z-]+)?(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const path = new URL(route.request().url()).pathname;
    const list = path.split("/").at(-1)!;
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (emptied[stage].includes(list)) body.items = [];
    if (list === "brand") body.customized = stage === "half";
    if (/organizations\/[^/]+$/.test(path)) body.joinLinkEnabled = stage === "half";
    await route.fulfill({ response, json: body });
  });
}

for (const width of [360, 1280]) {
  test(`setup checklist at ${width} px: before, a new studio, and half done`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    const region = page.getByRole("region", { name: "מכינים את הסטודיו" });

    // Before: the home as it was, which is what an owner sees after closing the checklist.
    await page.goto(`/o/${studioSlug}`);
    await expect(page.getByRole("table", { name: "חברי הסטודיו" })).toBeVisible();
    if (await region.isVisible()) await region.getByRole("button", { name: "סגירת רשימת ההכנה" }).click();
    await expect(region).toBeHidden();
    // The table is masked: dev holds sign-ups, and a picture never carries their addresses.
    await page.screenshot({
      path: testInfo.outputPath(`before-${width}.png`),
      mask: [page.getByRole("table", { name: "חברי הסטודיו" })],
    });

    for (const stage of ["new", "half"] as const) {
      await page.evaluate(() => {
        for (const key of Object.keys(window.localStorage))
          if (key.startsWith("tempo.setup-checklist.")) window.localStorage.removeItem(key);
      });
      await page.unrouteAll({ behavior: "wait" });
      await showAs(page, stage);
      await page.reload();
      await expect(region).toBeVisible();
      await expect(region.getByText(stage === "new" ? /^1 מתוך 9 שלבים/ : /^6 מתוך 9 שלבים/)).toBeVisible();
      await expectNoSeriousA11yViolations(page, testInfo, `setup checklist, ${stage}, ${width} px`);
      await region.screenshot({ path: testInfo.outputPath(`after-${stage}-${width}.png`) });
    }

    await region.getByRole("button", { name: "סגירת רשימת ההכנה" }).click();
    await expect(region).toBeHidden();
    await page.reload();
    await expect(page.getByRole("table", { name: "חברי הסטודיו" })).toBeVisible();
    await expect(region).toBeHidden();
  });
}
