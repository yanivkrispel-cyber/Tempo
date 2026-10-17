import { expect, test, type Page } from "@playwright/test";
import { adminUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";
import { SCREENS, openScreen, settle } from "../../support/screens";

// D15 (#317): the console's menu on a phone, by keyboard and by touch, in a real browser. jsdom lets focus land inside
// an inert subtree and a browser does not, so this is where a lost focus shows (the after-merge review of #320 found
// that closing the drawer left focus on the page instead of the button that opened it). Read-only.
const phone = SCREENS.find((screen) => screen.name === "phone-360")!;

test.beforeAll(() => {
  // Checked here, at run time: the sign-in setup writes the session after Playwright has collected this file.
  test.skip(!hasSession(sessionStatePath), noSessionMessage);
});

async function openToday(page: Page) {
  await page.goto(`${adminUrl}/o/${studioSlug}/today`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await settle(page);
}

/** Where focus is now: inside the drawer, nowhere (the page itself), or somewhere else on the page. */
const focusIn = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "page";
    return active.closest("#console-menu") ? "drawer" : "outside";
  });

test("the console menu on a phone by keyboard: closed it takes no focus, open it keeps it, closed it hands it back", async ({
  browser,
}) => {
  const context = await openScreen(browser, phone, sessionStatePath);
  try {
    const page = await context.newPage();
    await openToday(page);
    const drawer = page.locator("#console-menu");
    const menuButton = page.getByRole("button", { name: "התפריט של הסטודיו" });
    const more = page.getByRole("navigation", { name: "קיצורי דרך" }).getByRole("button", { name: "עוד" });
    await expect(drawer).toBeHidden();

    // Closed: Tab walks the top bar, the page and the bottom bar, and never into the drawer.
    await page.locator("body").focus();
    for (let presses = 0; presses < 200; presses++) {
      await page.keyboard.press("Tab");
      expect(await focusIn(page), `Tab ${presses + 1} lands in the closed drawer`).not.toBe("drawer");
      if (await more.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(more).toBeFocused();

    // Enter on the menu button opens it and moves focus in; the page behind is inert, so Tab stays inside.
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await expect(drawer).toHaveAttribute("data-open");
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toBeFocused();
    for (let presses = 0; presses < 20; presses++) {
      await page.keyboard.press("Tab");
      expect(await focusIn(page), `Tab ${presses + 1} leaves the open drawer`).not.toBe("outside");
    }

    // Escape closes it and gives focus back to the menu button.
    await page.keyboard.press("Escape");
    await expect(drawer).not.toHaveAttribute("data-open");
    await expect(menuButton).toBeFocused();

    // The same from עוד on the bottom bar, closed by the drawer's own close button.
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(drawer).toHaveAttribute("data-open");
    await drawer.getByRole("button", { name: "סגירת התפריט" }).focus();
    await page.keyboard.press("Enter");
    await expect(drawer).not.toHaveAttribute("data-open");
    await expect(more).toBeFocused();
  } finally {
    await context.close();
  }
});

test("the console menu on a phone by touch: the scrim closes it, and a section opens with the bottom bar marking it", async ({
  browser,
}) => {
  const context = await openScreen(browser, phone, sessionStatePath);
  try {
    const page = await context.newPage();
    await openToday(page);
    const drawer = page.locator("#console-menu");
    const menuButton = page.getByRole("button", { name: "התפריט של הסטודיו" });

    await menuButton.tap();
    await expect(drawer).toHaveAttribute("data-open");
    // The scrim beside the drawer, at the end edge of the screen (the drawer slides in from the start, the right).
    await page.locator(".tp-scrim").tap({ position: { x: 12, y: 400 } });
    await expect(drawer).not.toHaveAttribute("data-open");
    await expect(drawer).toBeHidden();

    await menuButton.tap();
    await drawer.getByRole("link", { name: "אנשים" }).tap();
    await expect(page).toHaveURL(new RegExp(`/o/${studioSlug}/people$`));
    await expect(drawer).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "קיצורי דרך" }).getByRole("link", { name: "אנשים" }),
    ).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
  }
});
