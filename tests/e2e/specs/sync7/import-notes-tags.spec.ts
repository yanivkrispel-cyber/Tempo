import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  call,
  createUser,
  deleteUser,
  hostedUi,
  newUser,
  ok,
  signIn,
  userExists,
  userPoolId,
} from "../../support/accounts";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl } from "../../support/env";
import { measureFit, openScreen, SCREENS, settle } from "../../support/screens";

/**
 * SYNC 7 (day board #321, Z3), against the dev API and the dev sites, with two fresh users and no smoke user: the
 * owner at a computer (1280px, mouse and keyboard) and a staff member on a phone (360px, touch), D15.
 * 1. The owner opens a studio, makes two tags, and imports a made-up six-row file with one of them as the batch tag:
 *    the check shows 3 to create, 1 already in the studio, 1 repeated in the file and 1 invalid, and the import
 *    creates the 3, each with the batch tag (docs/34, I-1 to I-8).
 * 2. Staff open an imported person on the phone and add a note and a tag; the people list filters by that tag.
 * 3. Staff, without `people.import`, see no Import button, the route says so and the API refuses; staff can't create
 *    a tag either.
 * 4. The owner exports that person: the note (author by role) and the tags are in the file. After an erase, the note
 *    and the tag links are gone.
 * axe runs on every new screen: the import page, the Tags card, the person card's tags and notes, the filtered list.
 *
 * Cleanup: the staff member deletes their own login (A-1). The owner can't (the studio's only owner), so their
 * Cognito user is deleted here, and the studio waits for the operator's cleanup (A-4). Every name is `e2e-`, every
 * email `e2e-…@example.com`; no phone number here is a plausible real one; no note holds health information.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const run = Date.now().toString(36);
const owner = newUser("sync7", "owner", run);
const staff = newUser("sync7", "staff", run);
const studioName = `e2e-sync7 סטודיו ${run}`;
const slug = `e2e-sync7-${run}`;
const batchTag = "e2e-ייבוא";
const staffTag = "e2e-בוקר";
const note = "e2e-sync7: מעדיפה את השורה הראשונה";
const email = (who: string) => `e2e-sync7-${who}-${run}@example.com`;
const roleIds = { staff: "00000000-0000-7000-8000-000000000003" };

// Line 5 is already in the studio, line 6 repeats line 2's email, line 7's phone is not a phone.
const csv = [
  "שם מלא,טלפון,מייל",
  `e2e-sync7 אלף,,${email("a")}`,
  `e2e-sync7 בית,,${email("b")}`,
  `e2e-sync7 גימל,,${email("c")}`,
  `e2e-sync7 קיים שוב,,${email("exists")}`,
  `e2e-sync7 דלת,,${email("a")}`,
  "e2e-sync7 הא,12,",
].join("\r\n");

const desktop = SCREENS.find((screen) => screen.name === "laptop-1280") ?? {
  name: "laptop-1280",
  width: 1280,
  height: 800,
  touch: false,
};
const phone = SCREENS.find((screen) => screen.name === "phone-360")!;

let poolId = "";
let ownerPage: Page;
let staffPage: Page;
let organizationId = "";
let batchTagId = "";
let staffTagId = "";
let alephId = "";

const console_ = (path: string) => `${adminUrl}/o/${slug}${path}`;
const studio = <T = unknown>(method: string, path: string, data?: unknown, headers?: Record<string, string>) =>
  ok<T>(ownerPage, method, `/organizations/${organizationId}${path}`, data, headers);

/** A screen fits: nothing scrolls sideways, and on a phone no control is under 44px. */
async function expectFits(page: Page, screen: typeof phone, label: string) {
  const fit = await measureFit(page, screen);
  expect.soft(fit.overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
  expect.soft(fit.smallTargets, `${label} has controls under 44px`).toEqual([]);
}

/** A step-up (a sign-in in the last ten minutes) when the console asks for it, then back to `path`. */
async function stepUpIfAsked(page: Page, path: string): Promise<boolean> {
  const again = page.getByRole("button", { name: "התחברות מחדש" }).first();
  try {
    await again.waitFor({ timeout: 8_000 });
  } catch {
    return false;
  }
  await again.click();
  await hostedUi(page, owner, adminUrl);
  await page.goto(console_(path));
  return true;
}

test.beforeAll(async ({ browser }) => {
  poolId = userPoolId();
  test.skip(!poolId || !process.env.E2E_API_URL, "The dev user pool or API is not resolved: sign in to AWS first.");
  createUser(poolId, owner);
  createUser(poolId, staff);
  ownerPage = await (await openScreen(browser, desktop)).newPage();
  staffPage = await (await openScreen(browser, phone)).newPage();
});

test.afterAll(async () => {
  for (const user of [owner, staff]) {
    if (deleteUser(poolId, user)) console.log(`Deleted the Cognito user ${user.email}.`);
  }
  if (organizationId) console.log(`Left on dev for the operator's cleanup (A-4): studio ${slug} (${organizationId}).`);
});

test("1. the owner imports a made-up file with a batch tag: 3 created, 1 exists, 1 repeated, 1 invalid", async () => {
  const testInfo = test.info();
  await signIn(ownerPage, adminUrl, owner);
  await expect(ownerPage.getByRole("heading", { name: "פתיחת סטודיו חדש" })).toBeVisible();
  await ownerPage.getByRole("textbox", { name: /שם הסטודיו/ }).fill(studioName);
  await ownerPage.getByRole("textbox", { name: /כתובת/ }).fill(slug);
  await ownerPage.getByRole("button", { name: "פתיחת הסטודיו" }).click();
  await ownerPage.waitForURL((url) => url.pathname.startsWith(`/o/${slug}`), { timeout: 30_000 });
  const me = await ok<{ memberships: { organization: { id: string; slug: string } }[] }>(ownerPage, "GET", "/me");
  organizationId = me.memberships.find((membership) => membership.organization.slug === slug)!.organization.id;
  await studio("POST", "/people", { displayName: "e2e-sync7 קיים", email: email("exists") });

  // The two tags, in the settings' Tags card.
  await ownerPage.goto(console_("/settings"));
  const card = ownerPage.getByRole("region", { name: "תגיות" });
  for (const [name, colour] of [
    [batchTag, "כחול"],
    [staffTag, "ענבר"],
  ] as const) {
    await card.getByRole("button", { name: "תגית חדשה" }).click();
    const dialog = ownerPage.getByRole("dialog", { name: "תגית חדשה" });
    await dialog.getByRole("textbox", { name: /שם/ }).fill(name);
    await dialog.getByRole("combobox", { name: "צבע" }).selectOption({ label: colour });
    await dialog.getByRole("button", { name: "שמירה" }).click();
    await expect(card.getByRole("list", { name: "התגיות" }).getByText(name)).toBeVisible();
  }
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "console settings, the Tags card", "#tags");
  const tags = await studio<{ items: { id: string; name: string }[] }>("GET", "/tags");
  batchTagId = tags.items.find((tag) => tag.name === batchTag)!.id;
  staffTagId = tags.items.find((tag) => tag.name === staffTag)!.id;

  // The import, from the people list's button.
  await ownerPage.goto(console_("/people"));
  await ownerPage.getByRole("link", { name: "ייבוא מקובץ" }).click();
  await expect(ownerPage.getByRole("heading", { level: 1, name: "ייבוא מקובץ" })).toBeVisible();
  await ownerPage
    .getByLabel("בחירת קובץ")
    .setInputFiles({ name: "e2e-sync7.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(ownerPage.getByRole("combobox", { name: "שם מלא" })).toHaveValue("0");
  await expect(ownerPage.getByRole("combobox", { name: "מייל" })).toHaveValue("2");
  await ownerPage.getByRole("combobox", { name: "תגית לכל מי שייווסף" }).selectOption({ label: batchTag });
  await ownerPage.getByRole("button", { name: "בדיקת 6 השורות" }).click();
  await expect(ownerPage.getByRole("heading", { name: "הבדיקה" })).toBeFocused({ timeout: 30_000 });
  const totals = ownerPage.getByRole("list", { name: /סיכום 6 השורות/ });
  await expect(totals).toContainText("3 ייווצרו");
  await expect(totals).toContainText("1 כבר בסטודיו");
  await expect(totals).toContainText("1 כפולים בקובץ");
  await expect(totals).toContainText("1 לא תקינים");
  const results = ownerPage.getByRole("table", { name: "התוצאה לכל שורה" });
  await expect(results.getByRole("row", { name: /e2e-sync7 דלת/ })).toContainText("כמו בשורה 2");
  await expect(results.getByRole("row", { name: /e2e-sync7 הא/ })).toContainText("מספר הטלפון לא תקין");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "console import, the check");
  await expectFits(ownerPage, desktop, "console import, the check");

  await ownerPage.getByRole("button", { name: "ייבוא 3 אנשים" }).click();
  await expect(ownerPage.getByRole("heading", { name: "3 אנשים נוספו לסטודיו" })).toBeVisible({ timeout: 30_000 });
  await expect(ownerPage.getByText("כל מי שנוסף קיבל את התגית")).toBeVisible();
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "console import, done");

  const tagged = await studio<{ items: { id: string; displayName: string; source: string }[] }>(
    "GET",
    `/people?tag=${batchTagId}&limit=50`,
  );
  expect(tagged.items.map((person) => person.displayName).sort()).toEqual(
    ["e2e-sync7 אלף", "e2e-sync7 בית", "e2e-sync7 גימל"].sort(),
  );
  expect(tagged.items.every((person) => person.source === "import")).toBe(true);
  alephId = tagged.items.find((person) => person.displayName === "e2e-sync7 אלף")!.id;
});

test("2. staff on a phone add a note and a tag to an imported person, and filter the list by the tag", async () => {
  const testInfo = test.info();
  // Staff join as a member through the member app's invitation, then the owner gives them the staff role.
  const staffPerson = await studio<{ id: string }>("POST", "/people", {
    displayName: "e2e-sync7-staff",
    email: staff.email,
  });
  const invitation = await studio<{ link: string }>("POST", `/people/${staffPerson.id}/invite`, { email: staff.email });
  const link = invitation.link;
  expect(link, "the invitation came back without a link").toContain("#");
  await staffPage.goto(`${clientUrl}/invite#${link.split("#")[1]}`);
  await staffPage
    .getByRole("button", { name: /התחברות/ })
    .first()
    .click();
  await hostedUi(staffPage, staff, clientUrl);
  if (!staffPage.url().includes("/invite")) await staffPage.goto(`${clientUrl}/invite#${link.split("#")[1]}`);
  await staffPage.getByRole("button", { name: "אישור ההצטרפות" }).click();
  await staffPage.waitForURL((url) => !url.pathname.startsWith("/invite"), { timeout: 30_000 });
  const members = await studio<{ items: { id: string; email: string; version: string }[] }>("GET", "/members");
  const row = members.items.find((candidate) => candidate.email === staff.email)!;
  await studio("PUT", `/members/${row.id}/roles`, { roleIds: [roleIds.staff] }, { "If-Match": row.version });

  await signIn(staffPage, adminUrl, staff);
  await staffPage.goto(console_(`/people/${alephId}`));
  const tags = staffPage.getByRole("region", { name: "תגיות" });
  await expect(tags.getByText(batchTag)).toBeVisible();
  await tags.getByRole("combobox", { name: "הוספת תגית" }).selectOption({ label: staffTag });
  await tags.getByRole("button", { name: "הוספה" }).tap();
  await expect(tags.getByText(staffTag)).toBeVisible();

  const notes = staffPage.getByRole("region", { name: "הערות צוות" });
  await expect(notes.getByText(/לא כותבים כאן מידע רפואי/)).toBeVisible();
  await notes.getByRole("textbox", { name: "הערה חדשה" }).fill(note);
  await notes.getByRole("button", { name: "שמירת ההערה" }).tap();
  await expect(notes.getByRole("list", { name: "הערות" }).getByText(note)).toBeVisible();
  await settle(staffPage);
  await expectNoSeriousA11yViolations(staffPage, testInfo, "console person card, tags and notes, phone");
  await expectFits(staffPage, phone, "console person card, phone");

  await staffPage.goto(console_("/people"));
  await staffPage.getByRole("combobox", { name: "סינון לפי תגית" }).selectOption({ label: staffTag });
  await expect(staffPage).toHaveURL(new RegExp(`tag=${staffTagId}`));
  const list = staffPage.getByRole("table", { name: "אנשים" });
  await expect(list.getByRole("link", { name: "e2e-sync7 אלף" })).toBeVisible();
  await expect(list.getByRole("link")).toHaveCount(1);
  await expectNoSeriousA11yViolations(staffPage, testInfo, "console people list filtered by a tag, phone");
  await expectFits(staffPage, phone, "console people list filtered, phone");
});

test("3. staff see no import and can't create a tag; the route and the API refuse them", async () => {
  await staffPage.goto(console_("/people"));
  await expect(staffPage.getByRole("heading", { level: 1, name: "אנשים" })).toBeVisible();
  await expect(staffPage.getByRole("link", { name: "ייבוא מקובץ" })).toHaveCount(0);
  await staffPage.goto(console_("/people/import"));
  await expect(staffPage.getByRole("heading", { level: 1, name: "אין לך הרשאה לייבא אנשים" })).toBeVisible();

  const importing = await call<{ code: string }>(staffPage, "POST", `/organizations/${organizationId}/people/import`, {
    data: { dryRun: true, rows: [{ line: 2, displayName: "e2e-sync7 אסור", email: email("denied") }] },
  });
  expect(importing.status).toBe(403);
  const tagging = await call<{ code: string }>(staffPage, "POST", `/organizations/${organizationId}/tags`, {
    data: { name: "e2e-אסור", color: 1 },
  });
  expect(tagging.status).toBe(403);
});

test("4. the owner's export carries the note and the tags; after an erase both are gone", async () => {
  await ownerPage.goto(console_(`/people/${alephId}`));
  await expect(ownerPage.getByRole("region", { name: "הערות צוות" }).getByText(note)).toBeVisible();

  const exportFile = async () => {
    const download = ownerPage.waitForEvent("download", { timeout: 20_000 });
    download.catch(() => undefined);
    await ownerPage.getByRole("button", { name: "ייצוא הנתונים" }).click();
    return download;
  };
  let pending = exportFile();
  if (await stepUpIfAsked(ownerPage, `/people/${alephId}`)) pending = exportFile();
  const file = await (await pending).path();
  const exported = JSON.parse(readFileSync(file, "utf8")) as {
    tags?: string[];
    notes?: { body: string; authorRole: string }[];
  };
  expect(exported.tags?.sort()).toEqual([batchTag, staffTag].sort());
  expect(exported.notes).toEqual([expect.objectContaining({ body: note, authorRole: "staff" })]);
  expect(JSON.stringify(exported.notes)).not.toContain("e2e-sync7-staff");

  const erase = async () => {
    await ownerPage.getByRole("button", { name: "מחיקת הנתונים" }).click();
    const dialog = ownerPage.getByRole("dialog", { name: "מחיקת הנתונים" });
    await dialog.getByRole("textbox", { name: /סיבה/ }).fill("e2e sync7 cleanup");
    await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();
    return dialog;
  };
  let dialog = await erase();
  if (await stepUpIfAsked(ownerPage, `/people/${alephId}`)) dialog = await erase();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const notes = await studio<{ items: unknown[] }>("GET", `/people/${alephId}/notes`);
  expect(notes.items).toEqual([]);
  const person = await studio<{ status: string; tags: unknown[] }>("GET", `/people/${alephId}`);
  expect(person.status).toBe("anonymized");
  expect(person.tags).toEqual([]);
  const stillTagged = await studio<{ items: { id: string }[] }>("GET", `/people?tag=${staffTagId}&limit=50`);
  expect(stillTagged.items.map((item) => item.id)).not.toContain(alephId);
});

test("5. the staff member deletes their own login (A-1)", async () => {
  await staffPage.goto(`${adminUrl}/account/security`);
  const card = staffPage.getByRole("region", { name: "מחיקת החשבון" });
  const confirm = async () => {
    await card.getByRole("button", { name: "מחיקת החשבון" }).click();
    const dialog = staffPage.getByRole("dialog", { name: "מחיקת החשבון" });
    await dialog.getByRole("textbox", { name: /כתובת המייל של החשבון/ }).fill(staff.email);
    await dialog.getByRole("button", { name: "מחיקת החשבון" }).click();
    return dialog;
  };
  const dialog = await confirm();
  const signedOut = staffPage.waitForURL((url) => url.origin === adminUrl && url.pathname === "/login", {
    timeout: 30_000,
  });
  signedOut.catch(() => undefined);
  const stepUp = dialog.getByRole("button", { name: "התחברות מחדש" });
  const askedAgain = stepUp.waitFor({ timeout: 30_000 });
  askedAgain.catch(() => undefined);
  const first = await Promise.race([signedOut.then(() => "out" as const), askedAgain.then(() => "step-up" as const)]);
  if (first === "step-up") {
    await stepUp.click();
    await hostedUi(staffPage, staff, adminUrl);
    await staffPage.goto(`${adminUrl}/account/security`);
    await confirm();
    await staffPage.waitForURL((url) => url.origin === adminUrl && url.pathname === "/login", { timeout: 30_000 });
  } else {
    await signedOut;
  }
  await expect.poll(() => userExists(poolId, staff), { timeout: 30_000 }).toBe(false);
});
