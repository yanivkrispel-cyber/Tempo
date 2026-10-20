import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";
import { SCREENS, keepScreenshot, openScreen, settle } from "../../support/screens";

// Board #347, P-3: both apps offer the install from inside them, never on the first visit. Chrome's prompt is
// faked here (a real one needs an installable origin and a user's click on its dialog); an iPhone is told by its
// user agent and gets Safari's steps. Read-only.
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const screens = SCREENS.filter((screen) => screen.audit);

test.beforeAll(() => {
  test.skip(!hasSession(sessionStatePath), noSessionMessage);
});

/** What Chrome fires when the app may be installed; the page records each call to `prompt`. */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => {
        (window as unknown as { prompted: number }).prompted = 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
}

const apps = [
  { app: "client-web", url: () => `${clientUrl}/profile`, row: "התקנת האפליקציה" },
  { app: "admin-web", url: () => `${adminUrl}/o/${studioSlug}/settings`, row: "התקנת האפליקציה" },
] as const;

for (const { app, url, row } of apps) {
  for (const screen of screens) {
    test(`${app} on ${screen.name}: the install row takes the browser's prompt`, async ({ browser }, testInfo) => {
      const context = await openScreen(browser, screen, sessionStatePath);
      try {
        const page = await context.newPage();
        await page.goto(url());
        await settle(page);
        const button = page.getByRole("button", { name: new RegExp(row) });
        await expect(button).toHaveCount(0);

        await offerInstall(page);
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
        await expectNoSeriousA11yViolations(page, testInfo, `${app} install row on ${screen.name}`);
        await keepScreenshot(page, app, "install-row", screen);
        await button.click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
      } finally {
        await context.close();
      }
    });

    test(`${app} on ${screen.name}: an iPhone gets Safari's steps`, async ({ browser }, testInfo) => {
      // `openScreen`'s context, as an iPhone.
      const context = await browser.newContext({
        viewport: { width: screen.width, height: screen.height },
        isMobile: screen.touch,
        hasTouch: screen.touch,
        locale: "he-IL",
        timezoneId: "Asia/Jerusalem",
        userAgent: iphone,
        storageState: sessionStatePath,
      });
      try {
        const page = await context.newPage();
        await page.goto(url());
        await settle(page);
        await page.getByRole("button", { name: new RegExp(row) }).click();
        const sheet = page.getByRole("dialog", { name: "התקנה באייפון" });
        await expect(sheet.getByRole("listitem")).toHaveCount(3);
        await expectNoSeriousA11yViolations(page, testInfo, `${app} iPhone steps on ${screen.name}`);
        await keepScreenshot(page, app, "install-steps", screen);
        await sheet.getByRole("button", { name: "הבנתי" }).click();
        await expect(sheet).toBeHidden();
      } finally {
        await context.close();
      }
    });
  }
}

// Board #404, SL-7: Instagram's own browser would install its own view, not the studio's, so nothing is offered
// there even when it fires a prompt. Read-only.
for (const screen of screens) {
  test(`client-web on ${screen.name}: Instagram's browser gets no install`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: screen.width, height: screen.height },
      isMobile: screen.touch,
      hasTouch: screen.touch,
      locale: "he-IL",
      timezoneId: "Asia/Jerusalem",
      userAgent: `${iphone.replace(" Safari/604.1", "")} Instagram 390.0.0.27.80`,
      storageState: sessionStatePath,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${clientUrl}/profile`);
      await settle(page);
      await offerInstall(page);
      await expect(page.getByRole("button", { name: /התקנת האפליקציה/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
