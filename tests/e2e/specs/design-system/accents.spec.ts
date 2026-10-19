import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// WL2 (docs/35 section 3): the eight accents from disk (no app, no sign-in), each on real buttons, chips, a toggle,
// a sign-in card and the pass card, in light and dark. Every accent sets its own brand tokens, sage is today's look,
// and axe finds no text under AA contrast on any of them.
const pageUrl = new URL("../../../../packages/design-system/docs/accents.html", import.meta.url).href;
const tokens = JSON.parse(
  readFileSync(new URL("../../../../packages/design-system/tokens/tokens.json", import.meta.url), "utf8"),
) as {
  color: { tokens: Array<{ name: string; value: Record<string, string> | string }> };
  accents: { list: Array<{ id: string; value: Record<"light" | "dark", Record<string, string>> }> };
};

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

for (const width of [360, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("every accent sets its brand tokens in both themes", async ({ page }) => {
      for (const theme of ["light", "dark"] as const) {
        await page.goto(`${pageUrl}#${theme}`);
        for (const accent of tokens.accents.list) {
          const panel = page.locator(`#${theme}-${accent.id}`);
          const brand = await panel.evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());
          const ink = await panel.evaluate((el) => getComputedStyle(el).getPropertyValue("--brand-ink").trim());
          // The button's gradient is derived from the brand, so it must follow an accent set on the panel too.
          const button = await panel
            .getByRole("button", { name: "הזמנת מקום" })
            .evaluate((el) => getComputedStyle(el).backgroundImage);
          expect(button, `${accent.id} ${theme} primary button`).toContain(rgb(accent.value[theme].brand));
          expect({ accent: accent.id, theme, brand, ink }).toEqual({
            accent: accent.id,
            theme,
            brand: accent.value[theme].brand,
            ink: accent.value[theme]["brand-ink"],
          });
        }
      }
    });

    for (const theme of ["light", "dark"] as const) {
      test(`no text on any accent is under AA contrast, and nothing scrolls sideways, ${theme}`, async ({ page }) => {
        await page.goto(`${pageUrl}#${theme}`);
        await expect(page.locator(`[data-accent][id^="${theme}-"]`)).toHaveCount(8);
        const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
        expect(
          results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`)),
        ).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test("sage is today's look: the same brand as the page without an accent", async ({ page }) => {
  await page.goto(pageUrl);
  const root = tokens.color.tokens.find((token) => token.name === "brand")!.value as Record<string, string>;
  const sage = await page
    .locator("#light-sage")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());
  expect(sage).toBe(root.light);
});
