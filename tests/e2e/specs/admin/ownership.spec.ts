import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// Ownership lives on the members screen (`/o/:slug`): the owner row, the outgoing or incoming offer banners, and
// "העברת הבעלות" in an active admin's actions menu (docs/27 section 3.5). The suite never sends an offer: that
// would need a second account, and a pending offer changes the studio for everyone using it.
test("ownership screen: the smoke user is the studio's owner, and the handover dialog opens and closes", async ({
  page,
}, testInfo) => {
  await page.goto(`/o/${studioSlug}`);
  await expect(page.getByRole("heading", { level: 1, name: "חברי הסטודיו" })).toBeVisible();

  const table = page.getByRole("table", { name: "חברי הסטודיו" });
  const ownerRow = table.getByRole("row").filter({ has: page.getByRole("cell", { name: "בעלים", exact: true }) });
  await expect(ownerRow).toHaveCount(1);
  await expect(ownerRow.getByText("פעיל", { exact: true })).toBeVisible();
  // The navigation shows the caller's role in this studio.
  await expect(page.getByRole("complementary").getByText("בעלים", { exact: true })).toBeVisible();
  // No offer is waiting in either direction.
  await expect(page.getByRole("button", { name: "ביטול ההצעה" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "קבלת הבעלות" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page, testInfo, "members and ownership");

  // The handover is offered only to an active admin. The smoke studio may have none.
  const adminRow = table
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "מנהל", exact: true }) })
    .filter({ hasText: "פעיל" })
    .first();
  if ((await adminRow.count()) === 0) {
    testInfo.annotations.push({
      type: "note",
      description: `${studioSlug} has no active admin, so the handover dialog was not opened.`,
    });
    return;
  }
  await adminRow.getByRole("button", { name: /פעולות/ }).click();
  await page.getByRole("menuitem", { name: "העברת הבעלות" }).click();
  const dialog = page.getByRole("dialog", { name: "העברת הבעלות" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "ownership handover dialog");
  await dialog.getByRole("button", { name: "ביטול" }).click();
  await expect(dialog).toBeHidden();
});
