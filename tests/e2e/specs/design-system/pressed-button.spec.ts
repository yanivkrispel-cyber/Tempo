import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";

// A secondary button used as a toggle (aria-pressed) must stay readable when pressed. The reports page's
// "תאריכים אחרים" took the primary button's dark sage under the secondary's dark ink and failed axe color-contrast on
// dev (board #347, O0, sync6 step 5). The design system's own preview page carries the stylesheets.
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

for (const theme of ["light", "dark"] as const) {
  test(`a pressed secondary button keeps its contrast, ${theme}`, async ({ page }, testInfo) => {
    await page.goto(previewUrl);
    await page.getByRole("button", { name: theme === "light" ? "בהיר" : "כהה" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => {
      const stage = document.createElement("section");
      stage.id = "pv-pressed";
      stage.innerHTML =
        '<button class="tp-btn tp-btn--secondary" type="button" aria-pressed="true">תאריכים אחרים</button>' +
        '<button class="tp-btn tp-btn--secondary tp-btn--sm" type="button" aria-pressed="true">קטן</button>' +
        '<button class="tp-btn" type="button" aria-pressed="true">ראשי</button>';
      document.body.prepend(stage);
    });
    await expectNoSeriousA11yViolations(page, testInfo, `pressed-button-${theme}`, "#pv-pressed");
  });
}
