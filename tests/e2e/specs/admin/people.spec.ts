import { expect, test } from "@playwright/test";
import { Api, e2eName } from "../../support/api";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);
test.describe.configure({ mode: "serial" });

const name = e2eName("person");
const email = `${name}@example.com`;
let api: Api;
let personId: string;

test.beforeAll(async () => {
  api = await Api.open();
  // Leftovers of an interrupted run.
  await api.revokeE2eInvitations();
  for (const leftover of await api.e2ePeople()) await api.removePerson(leftover.id);
  personId = (await api.createPerson({ displayName: name, email })).id;
});

test.afterAll(async () => {
  if (!api) return;
  await api.revokeE2eInvitations();
  if (personId) await api.removePerson(personId);
  await api.dispose();
});

test("people list: the e2e person is found by search, and the new-person dialog opens", async ({ page }, testInfo) => {
  await page.goto(`/o/${studioSlug}/people`);
  await expect(page.getByRole("heading", { level: 1, name: "אנשים" })).toBeVisible();
  await expect(page.getByRole("table", { name: "אנשים" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "people list");

  await page.getByRole("searchbox", { name: "חיפוש לפי שם, טלפון או מייל" }).fill(name);
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("table", { name: "אנשים" }).getByRole("row")).toHaveCount(2);

  await page.getByRole("button", { name: "אדם חדש" }).click();
  const dialog = page.getByRole("dialog", { name: "אדם חדש" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /שם לתצוגה/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "new-person dialog");
  await dialog.getByRole("button", { name: "ביטול" }).click();
  await expect(dialog).toBeHidden();
});

test("person card: details and contacts of the e2e person", async ({ page }, testInfo) => {
  await page.goto(`/o/${studioSlug}/people`);
  await page.getByRole("searchbox", { name: "חיפוש לפי שם, טלפון או מייל" }).fill(name);
  await page.getByRole("link", { name }).click();

  await expect(page).toHaveURL(new RegExp(`/o/${studioSlug}/people/${personId}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("region", { name: "פרטים" })).toBeVisible();
  const contacts = page.getByRole("region", { name: "פרטי קשר" });
  await expect(contacts.getByText(email)).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "person card");
});

test("invite dialog: inviting the e2e person to the app gives a link once", async ({ page }, testInfo) => {
  await page.goto(`/o/${studioSlug}/people/${personId}`);
  await page.getByRole("button", { name: "הזמנה לאפליקציה" }).click();

  const dialog = page.getByRole("dialog", { name: "הזמנה לאפליקציה" });
  await expect(dialog).toBeVisible();
  const address = dialog.getByRole("textbox", { name: /מייל/ });
  await expect(address).toHaveValue(email);
  await expectNoSeriousA11yViolations(page, testInfo, "invite dialog");

  // A malformed address is caught before any call.
  await address.fill("not-an-email");
  await dialog.getByRole("button", { name: "יצירת הזמנה" }).click();
  await expect(dialog.getByText("כתובת מייל לא תקינה")).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "invite dialog with an error");

  await address.fill(email);
  await dialog.getByRole("button", { name: "יצירת הזמנה" }).click();
  const ready = page.getByRole("dialog", { name: "ההזמנה מוכנה" });
  await expect(ready).toBeVisible();
  await expect(ready.getByRole("textbox", { name: "קישור ההזמנה" })).toHaveValue(/\/invite#/);
  await expectNoSeriousA11yViolations(page, testInfo, "invitation ready dialog");
  await ready.getByRole("button", { name: "סיום" }).click();
  await expect(ready).toBeHidden();
});
