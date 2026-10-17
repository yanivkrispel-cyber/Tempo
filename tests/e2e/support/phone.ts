import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./axe";

/** The narrowest phone the apps support (WCAG 1.4.10 reflow: 320 CSS pixels). */
export const NARROW_PHONE = { width: 320, height: 640 };

/**
 * Re-checks the screen at 320px: nothing scrolls sideways and axe still passes. The viewport is restored afterwards,
 * so the rest of the test runs at the project's device size.
 */
export async function expectFitsNarrowPhone(
  page: Page,
  testInfo: TestInfo,
  screen: string,
  include?: string,
): Promise<void> {
  const size = page.viewportSize();
  await page.setViewportSize(NARROW_PHONE);
  try {
    // The layout viewport (clientWidth), not window.innerWidth: on an emulated phone innerWidth grows to fit a page
    // that is too wide, so the old comparison never saw sideways scrolling on the Pixel 7 projects.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${screen} scrolls sideways at ${NARROW_PHONE.width}px`).toBeLessThanOrEqual(0);
    await expectNoSeriousA11yViolations(page, testInfo, `${screen} at ${NARROW_PHONE.width}px`, include);
  } finally {
    if (size) await page.setViewportSize(size);
  }
}
