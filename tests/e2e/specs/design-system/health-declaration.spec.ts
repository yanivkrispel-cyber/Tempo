import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";

// The health declaration's primitives (DAY-PLAN-5 X0, docs/31) on the design system's preview page, from disk with no
// app and no sign-in: axe at the narrowest phone width the apps support, in light and in dark.
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

test.use({ viewport: { width: 320, height: 720 } });

for (const theme of ["light", "dark"] as const) {
  test(`design-system preview, ${theme}: yes/no questions, signature and status chips pass axe at 320 px`, async ({
    page,
  }, testInfo) => {
    await page.goto(previewUrl);
    await page.getByRole("button", { name: theme === "light" ? "בהיר" : "כהה" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const questions = page.getByRole("group", { name: "שאלות ההצהרה" });
    await expect(questions.getByRole("group")).toHaveCount(2);
    await expect(page.getByRole("group", { name: "שאלה שנייה לדוגמה?" })).toHaveAccessibleDescription(
      "צריך לענות כן או לא.",
    );
    await expect(page.getByRole("group", { name: "חתימה" }).getByRole("checkbox")).toBeChecked();
    await expect(page.getByRole("group", { name: "מצבי הצהרה" }).locator(".tp-chip")).toHaveCount(5);

    // The keyboard reaches the answers and the focus ring shows on the knob.
    const firstYes = page.getByRole("group", { name: /^שאלה ראשונה לדוגמה, / }).getByRole("radio", { name: "כן" });
    await firstYes.focus();
    await page.keyboard.press("Space");
    await expect(firstYes).toBeChecked();

    // Each new section fits the phone, and each answer is a 44px target.
    for (const id of ["pv-questions", "pv-signature", "pv-health-status"]) {
      const section = page.locator(`section[aria-labelledby='${id}']`);
      const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow, `${id} overflows at 320 px`).toBeLessThanOrEqual(0);
    }
    const knob = await firstYes.evaluate((input) => input.nextElementSibling!.getBoundingClientRect().height);
    expect(knob).toBeGreaterThanOrEqual(44);

    await expectNoSeriousA11yViolations(
      page,
      testInfo,
      `questions-${theme}`,
      "section[aria-labelledby='pv-questions']",
    );
    await expectNoSeriousA11yViolations(
      page,
      testInfo,
      `signature-${theme}`,
      "section[aria-labelledby='pv-signature']",
    );
    await expectNoSeriousA11yViolations(
      page,
      testInfo,
      `health-status-${theme}`,
      "section[aria-labelledby='pv-health-status']",
    );
  });
}
