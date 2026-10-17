import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// #319: on the console's week at 1280px a day column is about 120px wide, and a class tile's title ran under its
// corner label ("3 פנויים", "מלא · 2 בהמתנה"). Tiles drawn with the design system's own CSS, in narrow and wide
// columns and with the label before or after the title in the markup (the specimen and the apps differ): the title
// and the label never overlap, and some of the title always shows.
const css = (file: string) => fileURLToPath(new URL(`../../../../packages/design-system/css/${file}`, import.meta.url));

const tile = (title: string, badge: string, badgeFirst: boolean) => {
  const count = `<span class="tp-event__count">${badge}</span>`;
  const name = `<span class="tp-event__title">${title}</span>`;
  return `<div class="tp-event tp-event--sage">${badgeFirst ? count + name : name + count}<span class="tp-event__meta">08:00 · 55 דק׳</span><span class="tp-event__fill"><i></i></span></div>`;
};

async function drawTiles(page: Page, width: number) {
  await page.setContent(`<!doctype html>
<html lang="he" dir="rtl">
  <head><meta charset="utf-8" /><title>אריחי שיעור</title></head>
  <body>
    <main style="display: grid; gap: 8px; width: ${width}px; padding: 8px">
      ${tile("פילאטיס מזרן", "3 פנויים", true)}
      ${tile("פילאטיס מזרן", "3 פנויים", false)}
      ${tile("פילאטיס מכשירים מתקדמים", "מלא · 2 בהמתנה", true)}
      ${tile("פילאטיס מכשירים מתקדמים", "מלא · 2 בהמתנה", false)}
      ${tile("e2e-sync5-class-mvbyzczu", "בוטל", true)}
    </main>
  </body>
</html>`);
  for (const file of ["tokens.css", "base.css", "components.css"]) await page.addStyleTag({ path: css(file) });
}

for (const width of [96, 120, 180, 320]) {
  test(`a class tile ${width}px wide keeps its title clear of its label (#319)`, async ({ page }) => {
    await drawTiles(page, width);
    const tiles = await page.locator(".tp-event").evaluateAll((elements) =>
      elements.map((element) => {
        const title = element.querySelector(".tp-event__title")!.getBoundingClientRect();
        const count = element.querySelector(".tp-event__count")!.getBoundingClientRect();
        const overlap =
          title.left < count.right && count.left < title.right && title.top < count.bottom && count.top < title.bottom;
        return {
          text: `${element.querySelector(".tp-event__title")!.textContent} / ${element.querySelector(".tp-event__count")!.textContent}`,
          overlap,
          titleWidth: Math.round(title.width),
          countInside: count.left >= element.getBoundingClientRect().left - 0.5,
        };
      }),
    );
    for (const tile of tiles) {
      expect(tile.overlap, `${tile.text}: the title runs under the label`).toBe(false);
      // At least a few letters of the name, ellipsis or not.
      expect(tile.titleWidth, `${tile.text}: the title has no room`).toBeGreaterThanOrEqual(36);
      expect(tile.countInside, `${tile.text}: the label sticks out of the tile`).toBe(true);
    }
  });
}
