import { expect, test } from "@playwright/test";

// The dialog primitive from disk (no app, no sign-in): a dialog taller than a phone keeps its buttons reachable,
// because it scrolls inside itself (found by the SYNC 5 run on #232: seven answers pushed "סגירה" off the screen).
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

test.use({ viewport: { width: 320, height: 640 } });

test("a dialog taller than the phone scrolls, and its last button can be pressed", async ({ page }) => {
  await page.goto(previewUrl);
  await page.evaluate(() => {
    const scrim = document.createElement("div");
    scrim.className = "tp-scrim";
    const lines = Array.from({ length: 40 }, (_, index) => `<p>שורה ${index + 1} בתוך החלון</p>`).join("");
    scrim.innerHTML = `<div class="tp-dialog" role="dialog" aria-label="חלון ארוך"><h2 class="tp-dialog__title">חלון ארוך</h2><div class="tp-dialog__body">${lines}</div><div class="tp-dialog__actions"><button class="tp-btn" type="button">סגירה</button></div></div>`;
    document.body.append(scrim);
  });
  const dialog = page.getByRole("dialog", { name: "חלון ארוך" });
  const box = await dialog.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(640);
  await dialog.getByRole("button", { name: "סגירה" }).click({ timeout: 5_000 });
});
