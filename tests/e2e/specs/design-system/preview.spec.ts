import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";

// The design system's own preview page (packages/design-system/docs/preview.html), opened from disk: no app, no
// sign-in. Each primitive added for docs/30 step 7 is audited at phone width, in light and in dark.
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

for (const theme of ["light", "dark"] as const) {
  test(`design-system preview, ${theme}: template preview and time range pass axe at phone width`, async ({
    page,
  }, testInfo) => {
    await page.goto(previewUrl);
    await page.getByRole("button", { name: theme === "light" ? "בהיר" : "כהה" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const inbox = page.getByRole("group", { name: "תצוגה מקדימה של הודעה בתיבה" });
    await expect(inbox).toBeVisible();
    await expect(page.getByRole("group", { name: "תצוגה מקדימה של התראת פוש" })).toBeVisible();
    await expect(page.getByRole("group", { name: "שעות שקטות" })).toBeVisible();

    // Nothing in the new sections is wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await expectNoSeriousA11yViolations(page, testInfo, `template-preview-${theme}`, "#pv-template-stage");
    await expectNoSeriousA11yViolations(page, testInfo, `time-range-${theme}`, "[aria-labelledby='pv-time-range']");
  });
}
