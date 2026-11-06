import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// The smoke studio's live join link stays as it is: the browser answers the replace itself with a sample link, so
// nothing is written to dev.
const sample = "https://tempo-members.pages.dev/join#e2e-sample-code";

for (const width of [360, 1280]) {
  test(`join link at ${width} px: the live link, the replace and the new link (P3 F2)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.route(/\/api\/v1\/organizations\/[^/]+(\/join-link)?$/, async (route) => {
      const method = route.request().method();
      if (method === "PUT") return route.fulfill({ json: { link: sample, createdAt: "2026-11-03T06:00:00Z" } });
      if (method !== "GET" || route.request().url().endsWith("/join-link")) return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), joinLinkEnabled: true } });
    });

    await page.goto(`/o/${studioSlug}/invitations`);
    const card = page.getByRole("region", { name: "קישור הצטרפות למתאמנים" });
    await expect(card.getByText("פעיל")).toBeVisible();
    await card.screenshot({ path: testInfo.outputPath(`live-${width}.png`) });

    await card.getByRole("button", { name: "החלפת הקישור" }).click();
    const dialog = page.getByRole("dialog", { name: "להחליף את קישור ההצטרפות?" });
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, `join link, replace dialog, ${width} px`);
    // The dialog only: the invitations behind the scrim carry addresses.
    await dialog.screenshot({ path: testInfo.outputPath(`confirm-${width}.png`) });
    await dialog.getByRole("button", { name: "החלפה" }).click();

    await expect(card.getByRole("textbox", { name: "קישור ההצטרפות החדש" })).toHaveValue(sample);
    await expect(card.getByRole("img", { name: "קוד QR לקישור ההצטרפות" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, `join link, new link, ${width} px`);
    await card.screenshot({ path: testInfo.outputPath(`new-${width}.png`) });
  });
}
