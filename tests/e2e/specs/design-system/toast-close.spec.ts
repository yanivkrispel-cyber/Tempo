import { expect, test } from "@playwright/test";

// A finger needs 44px (docs/25 section 4, D15). The toast's close X was 32px on a phone, so sync8 failed its fit
// check on the member profile after a buddy link (board #347, O4). The design system's own preview page carries the
// stylesheets; the toast is added to it here, on a touch screen and with a mouse. Its message is as long as a real
// one with an e2e name, which used to squeeze the button to 40px in the toast's flex row.
const previewUrl = new URL("../../../../packages/design-system/docs/preview.html", import.meta.url).href;

const toast =
  '<div class="tp-toast" role="status"><span class="tp-toast__tile"></span><span>את וe2e-sync8-maya-mve2oyoj מאיה חברות עכשיו, אפשר להירשם לשיעורים יחד</span>' +
  '<button type="button" class="tp-toast__close" aria-label="סגירה">×</button></div>';

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 800 } });

  test("the toast's close button is a full 44px target", async ({ page }) => {
    await page.goto(previewUrl);
    await page.evaluate((html) => document.body.insertAdjacentHTML("afterbegin", html), toast);
    const box = (await page.getByRole("button", { name: "סגירה" }).first().boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("with a mouse", () => {
  // The project's default is a phone; a computer has no touch.
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } });

  test("the toast's close button keeps its compact 32px", async ({ page }) => {
    await page.goto(previewUrl);
    await page.evaluate((html) => document.body.insertAdjacentHTML("afterbegin", html), toast);
    const box = (await page.getByRole("button", { name: "סגירה" }).first().boundingBox())!;
    expect(box.width).toBe(32);
    expect(box.height).toBe(32);
  });
});
