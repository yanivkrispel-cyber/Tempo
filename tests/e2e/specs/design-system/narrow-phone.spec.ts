import { expect, test } from "@playwright/test";
import { expectFitsNarrowPhone } from "../../support/phone";

// The 320 px check itself, on the design-system project's phone (Pixel 7): an emulated phone widens
// window.innerWidth to fit a page that is too wide, so the helper must measure against the layout viewport.
const page320 = (width: number) => `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>בדיקת רוחב</title>
  </head>
  <body style="margin: 0">
    <main><p style="width: ${width}px; margin: 0">תוכן ברוחב ${width}</p></main>
  </body>
</html>`;

test("expectFitsNarrowPhone fails a page wider than 320 px and passes one that fits", async ({ page }, testInfo) => {
  await page.setContent(page320(356));
  await expect(expectFitsNarrowPhone(page, testInfo, "too wide")).rejects.toThrow(/scrolls sideways at 320px/);
  await page.setContent(page320(300));
  await expectFitsNarrowPhone(page, testInfo, "fits");
});
