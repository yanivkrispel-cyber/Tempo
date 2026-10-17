import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The empty-state tile from disk (no app, no sign-in), in light and dark: its text passes axe's contrast check on the
// deep tile (found by the P2 dry run on #232: the console's "no studio yet" text was 4.3:1).
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

for (const theme of ["light", "dark"] as const) {
  test(`the empty-state tile's text meets AA contrast, ${theme}`, async ({ page }) => {
    await page.goto(previewUrl);
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      const tile = document.createElement("div");
      tile.className = "tp-empty";
      tile.id = "probe-empty";
      tile.innerHTML = `<p class="tp-empty__title">עוד אין כאן כלום</p><p>פתחו סטודיו חדש, או בקשו הזמנה לצוות.</p>`;
      document.body.prepend(tile);
    }, theme);
    const results = await new AxeBuilder({ page }).include("#probe-empty").withRules(["color-contrast"]).analyze();
    expect(results.violations.map((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
  });
}
