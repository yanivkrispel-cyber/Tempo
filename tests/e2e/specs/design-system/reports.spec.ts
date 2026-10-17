import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";

// The owner reports' primitives (DAY-PLAN-6 Y0, docs/32) on the design system's preview page, from disk with no
// app and no sign-in: axe at the narrowest phone width the apps support, in light and in dark.
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;
const sections = ["pv-kpi", "pv-bars", "pv-rows"] as const;

test.use({ viewport: { width: 320, height: 720 } });

for (const theme of ["light", "dark"] as const) {
  test(`design-system preview, ${theme}: KPI tiles, the weekly bar chart and link rows pass axe at 320 px`, async ({
    page,
  }, testInfo) => {
    await page.goto(previewUrl);
    await page.getByRole("button", { name: theme === "light" ? "בהיר" : "כהה" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // The change is in words, and the chart's figures reach a screen reader as a table, not as the drawing.
    await expect(page.getByRole("group", { name: "מדדי התקופה" }).locator(".tp-kpi")).toHaveCount(4);
    await expect(page.getByText("ירידה של 3.5% לעומת התקופה הקודמת")).toBeVisible();
    const chart = page.getByRole("figure", { name: "ביקורים לפי שבוע" });
    await expect(chart.locator(".tp-bars__plot")).toHaveAttribute("aria-hidden", "true");
    await expect(chart.getByRole("table", { name: "ביקורים לפי שבוע" }).getByRole("row")).toHaveCount(5);

    // Each row is a 44px link target.
    const rows = page.getByRole("list", { name: "כרטיסיות שמסתיימות בקרוב" }).getByRole("link");
    await expect(rows).toHaveCount(2);
    for (const box of await rows.evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }

    // Each new section fits the phone, absolutely placed parts included: a hidden table once kept .tp-table's width
    // and widened the page, which the section's own scroll width never showed.
    for (const id of sections) {
      const section = page.locator(`section[aria-labelledby='${id}']`);
      const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow, `${id} overflows at 320 px`).toBeLessThanOrEqual(0);
      // The page alone with this section: an absolutely placed part escapes the section's scroll width (and any
      // clipping parent short of its containing block), but not the page's.
      const widens = await page.evaluate((only) => {
        const cells = Array.from(document.querySelectorAll<HTMLElement>(".pv-cell"));
        const shown = cells.map((cell) => cell.style.display);
        for (const cell of cells) if (cell.getAttribute("aria-labelledby") !== only) cell.style.display = "none";
        // clientWidth, not innerWidth: on a phone (the Pixel 7 here) innerWidth grows to fit a too-wide page.
        const extra = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        cells.forEach((cell, index) => (cell.style.display = shown[index] ?? ""));
        return extra;
      }, id);
      expect(widens, `${id} widens the page at 320 px`).toBeLessThanOrEqual(0);
    }

    for (const id of sections) {
      await expectNoSeriousA11yViolations(page, testInfo, `${id}-${theme}`, `section[aria-labelledby='${id}']`);
    }
  });
}
