import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { e2eRoot } from "./env";

/**
 * The screens every console must fit (D15 in docs/claude-memory/decisions.md, #317): phones, tablets both ways and
 * computers. `touch` screens also get the touch-target check.
 */
export interface Screen {
  name: string;
  width: number;
  height: number;
  touch: boolean;
}

export const SCREENS: Screen[] = [
  { name: "phone-360", width: 360, height: 780, touch: true },
  { name: "phone-430", width: 430, height: 932, touch: true },
  { name: "tablet-768", width: 768, height: 1024, touch: true },
  { name: "tablet-1180", width: 1180, height: 820, touch: true },
  { name: "laptop-1440", width: 1440, height: 900, touch: false },
  { name: "desktop-1920", width: 1920, height: 1080, touch: false },
];

/** The smallest target a finger hits reliably (Apple HIG and `--touch-min` in the design tokens). */
export const TOUCH_MIN = 44;

/** A browser context sized like the screen, with touch where the screen has it. */
export function openScreen(browser: Browser, screen: Screen, storageState?: string): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    deviceScaleFactor: 1,
    isMobile: screen.touch,
    hasTouch: screen.touch,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    ...(storageState ? { storageState } : {}),
  });
}

/** Waits until the screen is drawn: the network is quiet, nothing is loading and the fonts are in. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.locator("[aria-busy='true'], .tp-skeleton")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export interface Fit {
  /** How many CSS pixels the page scrolls sideways (0 when it fits). */
  overflow: number;
  /** Controls smaller than TOUCH_MIN on a touch screen, as "WxH what". */
  smallTargets: string[];
}

/**
 * Measures the screen as it is now. Sideways scroll is the layout viewport (clientWidth), which an emulated phone
 * does not stretch. A touch target is the control's box, or its label's box for a check box or a radio; a link inside
 * running text is exempt (WCAG 2.5.8).
 */
export function measureFit(page: Page, screen: Screen): Promise<Fit> {
  return page.evaluate(
    ({ touch, min }) => {
      const root = document.documentElement;
      const overflow = root.scrollWidth - root.clientWidth;
      const smallTargets: string[] = [];
      if (!touch) return { overflow, smallTargets };

      const selector = [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "summary",
        "[role=button]",
        "[role=tab]",
        "[role=checkbox]",
        "[role=switch]",
        "[role=radio]",
        "[role=menuitem]",
        "[role=option]",
      ].join(",");
      const seen = new Set<Element>();
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (element.closest(".tp-sr-only, [aria-hidden='true'], [inert]")) continue;
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const parentText = element.parentElement?.textContent?.trim().length ?? 0;
        if (
          element.tagName === "A" &&
          style.display === "inline" &&
          parentText > (element.textContent?.trim().length ?? 0)
        )
          continue;
        const input = element as HTMLInputElement;
        const target =
          element.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio")
            ? (element.closest("label") ?? element)
            : element;
        if (seen.has(target)) continue;
        seen.add(target);
        const box = target.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.width >= min && box.height >= min) continue;
        const name = (
          element.getAttribute("aria-label") ??
          element.textContent ??
          element.getAttribute("placeholder") ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40);
        smallTargets.push(
          `${Math.round(box.width)}x${Math.round(box.height)} ${element.tagName.toLowerCase()} "${name}"`,
        );
      }
      return { overflow, smallTargets };
    },
    { touch: screen.touch, min: TOUCH_MIN },
  );
}

/** Where `E2E_SCREENSHOTS=1` keeps full-page pictures of every screen (gitignored with test-results). */
export const screenshotDir = join(e2eRoot, "test-results", "screens");

/** A full-page picture for review when `E2E_SCREENSHOTS=1`; never attached to the report. */
export async function keepScreenshot(page: Page, app: string, route: string, screen: Screen): Promise<void> {
  if (process.env.E2E_SCREENSHOTS !== "1") return;
  const dir = join(screenshotDir, app, screen.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${route}.png`), fullPage: true });
}

/** Records one screen's fit on the report, so a run lists every finding at once. */
export function annotateFit(testInfo: TestInfo, label: string, fit: Fit): void {
  if (fit.overflow > 0)
    testInfo.annotations.push({ type: "sideways scroll", description: `${label}: ${fit.overflow}px` });
  if (fit.smallTargets.length > 0)
    testInfo.annotations.push({
      type: "small touch targets",
      description: `${label}: ${fit.smallTargets.length} — ${fit.smallTargets.slice(0, 12).join("; ")}`,
    });
}
