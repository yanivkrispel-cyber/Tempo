import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";

// A link inside running text must not be told apart by colour alone (axe link-in-text-block, WCAG 1.4.1). The
// person page's "לניהול התגיות" sits in a muted caption and failed it on dev (board #347, O0). The design system's
// own preview page carries the stylesheets; the paragraphs are added to it here.
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

for (const theme of ["light", "dark"] as const) {
  test(`a link inside a sentence is underlined, ${theme}`, async ({ page }, testInfo) => {
    await page.goto(previewUrl);
    await page.getByRole("button", { name: theme === "light" ? "בהיר" : "כהה" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => {
      const stage = document.createElement("section");
      stage.id = "pv-inline-link";
      stage.innerHTML =
        '<p class="tp-caption tp-muted">כל התגיות של הסטודיו כבר כאן. <a href="#tags">לניהול התגיות</a></p>' +
        '<p>אפשר לקרוא <a href="#terms">את התנאים</a> לפני ההרשמה.</p>';
      document.body.prepend(stage);
    });

    for (const link of await page.locator("#pv-inline-link a").all()) {
      expect(await link.evaluate((a) => getComputedStyle(a).textDecorationLine)).toBe("underline");
    }
    await expectNoSeriousA11yViolations(page, testInfo, `inline-link-${theme}`, "#pv-inline-link");
  });
}
