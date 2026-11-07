import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// The contact comes from SSM on dev, which may hold none; the browser answers with a sample address instead, so the
// card always shows. Nothing is written to dev.
for (const width of [360, 1280]) {
  test(`help and contact at ${width} px (board #584, O4)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.route("**/api/v1/support-contact", (route) =>
      route.fulfill({ json: { contact: "help@tempo.example", kind: "email" } }),
    );

    await page.goto(`/o/${studioSlug}/today`);
    if (width === 360) await page.getByRole("button", { name: "עוד" }).click();
    const menu = page.locator("#console-menu");
    await menu.getByRole("link", { name: "עזרה ויצירת קשר" }).scrollIntoViewIfNeeded();
    await menu.screenshot({ path: testInfo.outputPath(`menu-${width}.png`) });
    await menu.getByRole("link", { name: "עזרה ויצירת קשר" }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${studioSlug}/help$`));
    await expect(page.getByRole("heading", { level: 1, name: "עזרה ויצירת קשר" })).toBeVisible();
    const contact = page.getByRole("region", { name: "יצירת קשר" });
    await expect(contact.getByRole("link", { name: "help@tempo.example" })).toHaveAttribute(
      "href",
      "mailto:help@tempo.example",
    );

    const payments = page.getByRole("region", { name: "תשלומים" });
    await payments.getByText("האם המתאמנים משלמים באפליקציה?").click();
    await expect(payments.locator("strong", { hasText: "מתן כרטיסייה או מנוי" })).toBeVisible();

    await expectNoSeriousA11yViolations(page, testInfo, `help, ${width} px`);
    await page.screenshot({ path: testInfo.outputPath(`help-${width}.png`), fullPage: true });
  });
}
