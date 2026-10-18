import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { clientUrl, hasSession, noSessionMessage, sessionStatePath } from "../../support/env";
import { SCREENS, openScreen, settle } from "../../support/screens";

// The member app's tab bar folds to its icons while the page scrolls down (P1). Its links must keep their names
// then: the review of #347's install row found the folded bar's links nameless, since `display: none` on the label
// takes it out of the accessibility tree as well. Read-only.
const phone = SCREENS.find((screen) => screen.name === "phone-360")!;

test.beforeAll(() => {
  test.skip(!hasSession(sessionStatePath), noSessionMessage);
});

test("the folded tab bar keeps the names of its links", async ({ browser }, testInfo) => {
  const context = await openScreen(browser, phone, sessionStatePath);
  try {
    const page = await context.newPage();
    await page.goto(`${clientUrl}/profile`);
    await settle(page);
    const bar = page.getByRole("navigation", { name: "ניווט" });

    await page.mouse.wheel(0, 600);
    await expect(bar).toHaveClass(/tp-tabbar--compact/);
    for (const name of ["בית", "מערכת", "הזמנות", "פרופיל"]) {
      await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
    }
    // The label is gone from sight, not from the tree.
    const label = bar.getByRole("link", { name: "בית", exact: true }).locator("span");
    expect(await label.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    await expectNoSeriousA11yViolations(page, testInfo, "member tab bar folded on phone-360");
  } finally {
    await context.close();
  }
});
