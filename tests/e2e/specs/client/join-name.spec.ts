import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// The smoke member already has a name and a studio, so the browser answers as a new account would: the session
// without a name, and a sample studio for the preview. The join itself is never sent, so nothing is written to dev.
const code = "e2e" + "x".repeat(20);

for (const width of [360, 1280]) {
  test(`join page at ${width} px asks a nameless account for its name (P3 F3)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.route("**/api/v1/session", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), displayName: null } });
    });
    await page.route("**/api/v1/join/preview", (route) =>
      route.fulfill({
        json: { organization: { id: "0199e5a1-0000-7000-8000-00000000e2e0", displayName: "סטודיו לדוגמה" } },
      }),
    );
    let joined = false;
    await page.route("**/api/v1/join", (route) => {
      joined = true;
      return route.abort();
    });

    await page.goto(`/join#${code}`);
    await expect(page.getByRole("heading", { name: "הצטרפות לסטודיו לדוגמה" })).toBeVisible();
    const name = page.getByRole("textbox", { name: /איך קוראים לך/ });
    await expect(name).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, `join page, ${width} px`);
    await page.screenshot({ path: testInfo.outputPath(`join-${width}.png`) });

    await page.getByRole("button", { name: "הצטרפות" }).click();
    await expect(name).toHaveAccessibleDescription("כתבו את השם שלכם, כך הסטודיו יידע מי הצטרף.");
    await page.screenshot({ path: testInfo.outputPath(`join-empty-${width}.png`) });
    expect(joined).toBe(false);
  });
}
