import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { devices, expect, test, type Page } from "@playwright/test";
import { createUser, deleteUser, hostedUi, newUser, signIn, userExists, userPoolId } from "../../support/accounts";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl, e2eRoot } from "../../support/env";
import { annotateFit, measureFit, openScreen, SCREENS, settle, type Screen } from "../../support/screens";
import { studioParts } from "../../support/studio";

/**
 * Pilot dry run P3 (board #584, O5, decision PL-6), against the dev API and the dev sites, with two fresh users and no
 * smoke user. A new owner and a new member go through the SCREENS only (the one API use is the Cognito users and
 * their cleanup, as in SYNC 6), and the run measures what it cost:
 *   1. The owner (a computer, 1280px) signs in, opens the studio from zero, sets the brand, adds a room, a class
 *      type, a punch-card product and a weekly class a few minutes ahead, and makes the join link.
 *   2. The member (Pixel 7) opens the join link, signs in and joins; the owner gives them the pass on their person
 *      card (the real path: there is no online payment); the member books the class.
 *   3. The owner marks the member attended on the class page.
 *   3b. The owner imports two people and their passes, as a studio moving from another system (after mark c, so
 *      a, b and c stay comparable with earlier runs; its own mark is d).
 *   4. The owner walks the same screens again at 390px: nothing scrolls sideways, targets are 44px, axe passes.
 * Wall-clock minutes and clicks (every `click`, `tap`, `check`, `uncheck` the spec performs, counted by wrapping them)
 * are taken at (a) the first weekly class saved, (b) the first member joined and (c) the first attended booking, and
 * written to test-results/pilot-p3/metrics.json.
 *
 * Fictional data only (E-1): every name and slug is `e2e-p3-…`, every address `e2e-p3-…@example.com`, passwords live
 * only in memory. One owner, one member, no load. The owner's Cognito user is deleted at the end; the studio stays
 * for the operator's cleanup (A-4, `tools/scripts/e2e-cleanup.mjs`).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);
test.use({ actionTimeout: 20_000 });

const run = Date.now().toString(36);
const owner = newUser("p3", "owner", run);
const member = newUser("p3", "member", run);
const slug = `e2e-p3-${run}`;
const studioName = `e2e-p3 סטודיו ${run}`;
const roomName = "e2e-p3-room";
const typeName = "e2e-p3-class";
const productName = "e2e-p3-card";
/** Far enough ahead for the member to join, be given a pass and book before it starts (bookings close at the start). */
const classLeadMinutes = 9;

const desktop = SCREENS.find((screen) => screen.name === "laptop-1280")!;
const phone390: Screen = { name: "phone-390", width: 390, height: 844, touch: true, audit: true };

// -- The meter ---------------------------------------------------------------------------------------------------

let started = Date.now();
const tally = { clicks: 0, owner: 0, member: 0 };
const actors = new WeakMap<Page, "owner" | "member">();
const marks: Record<string, { minutes: number; clicks: number; ownerClicks: number; memberClicks: number }> = {};
let patched = false;

/** Counts every click, tap, check and uncheck on any locator, by the actor whose page it belongs to. */
function patchLocators(page: Page) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(page.locator("html")) as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ["click", "tap", "check", "uncheck"]) {
    const original = proto[name]!;
    proto[name] = function (this: { page(): Page }, ...args: unknown[]) {
      tally.clicks += 1;
      const who = actors.get(this.page());
      if (who) tally[who] += 1;
      return original.apply(this, args);
    };
  }
}

function mark(label: string) {
  marks[label] = {
    minutes: Math.round(((Date.now() - started) / 60_000) * 10) / 10,
    clicks: tally.clicks,
    ownerClicks: tally.owner,
    memberClicks: tally.member,
  };
  console.log(`P3 ${label}: ${marks[label]!.minutes} min, ${marks[label]!.clicks} clicks`);
}

// -- State -------------------------------------------------------------------------------------------------------

let poolId = "";
let ownerPage: Page;
let memberPage: Page;
let joinLink = "";
let classStart = "";
let classStartsAt = 0;

/** Reserved for notes the run adds to metrics.json. */
const findings: string[] = [];

/** A picture for review when E2E_SCREENSHOTS=1 (kept in test-results, gitignored). */
async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS !== "1") return;
  const dir = join(e2eRoot, "test-results", "pilot-p3", "shots");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

const admin = (path: string) => `${adminUrl}/o/${slug}${path}`;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** A click on the console's menu, as a person goes from screen to screen (the drawer on a narrow screen). */
async function goTo(page: Page, label: string, heading: string) {
  const nav = page.getByRole("navigation", { name: "ניהול הסטודיו" });
  if (!(await nav.getByRole("link", { name: label, exact: true }).isVisible())) {
    await page.getByRole("button", { name: "התפריט של הסטודיו" }).click();
  }
  await nav.getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await settle(page);
}

test.beforeAll(async ({ browser }) => {
  poolId = userPoolId();
  test.skip(!poolId || !process.env.E2E_API_URL, "The dev user pool or API is not resolved: sign in to AWS first.");
  createUser(poolId, owner);
  createUser(poolId, member);
  ownerPage = await (await openScreen(browser, desktop)).newPage();
  const memberContext = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    storageState: { cookies: [], origins: [] },
  });
  memberPage = await memberContext.newPage();
  actors.set(ownerPage, "owner");
  actors.set(memberPage, "member");
  patchLocators(ownerPage);
});

test.afterEach(async () => {
  for (const a of test.info().annotations) console.log(`P3 note [${a.type}] ${a.description ?? ""}`.slice(0, 400));
});

test.afterAll(async () => {
  const dir = join(e2eRoot, "test-results", "pilot-p3");
  mkdirSync(dir, { recursive: true });
  const metrics = {
    run,
    marks,
    totalClicks: tally.clicks,
    byActor: { owner: tally.owner, member: tally.member },
    findings,
  };
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(`P3 metrics: ${JSON.stringify(metrics)}`);
  for (const user of [owner, member]) {
    if (poolId && userExists(poolId, user)) {
      deleteUser(poolId, user);
      console.log("Deleted an e2e-p3 Cognito user.");
    }
  }
  if (slug) console.log(`Left on dev for the operator's cleanup (A-4): studio ${slug}.`);
});

test("1. the owner opens the studio from zero and sets it up at a computer", async () => {
  const testInfo = test.info();
  started = Date.now();
  await signIn(ownerPage, adminUrl, owner);
  await expect(ownerPage.getByRole("heading", { name: "פתיחת סטודיו חדש" })).toBeVisible();
  await settle(ownerPage);
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "create studio");

  await ownerPage.getByRole("textbox", { name: /שם הסטודיו/ }).fill(studioName);
  await ownerPage.getByRole("textbox", { name: /כתובת/ }).fill(slug);
  await ownerPage.getByRole("button", { name: "פתיחת הסטודיו" }).click();
  await ownerPage.waitForURL((url) => url.pathname.startsWith(`/o/${slug}`), { timeout: 30_000 });
  await settle(ownerPage);
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "first screen of a new studio");
  await shot(ownerPage, "01-owner-first-screen");

  // The brand (Settings).
  await goTo(ownerPage, "הגדרות", "הגדרות הסטודיו");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "settings");
  const accents = ownerPage.getByRole("radiogroup", { name: "צבע המותג" }).getByRole("radio");
  await accents.nth(2).click();
  await ownerPage.getByRole("button", { name: "שמירת המיתוג" }).click();
  await expect(ownerPage.getByText("המיתוג נשמר")).toBeVisible();

  // A room.
  await goTo(ownerPage, "חדרים", "חדרים");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "rooms");
  await ownerPage.getByRole("button", { name: "חדר חדש" }).first().click();
  let dialog = ownerPage.getByRole("dialog", { name: "חדר חדש" });
  await dialog.getByRole("textbox", { name: /^שם/ }).fill(roomName);
  await dialog.getByRole("textbox", { name: /^מקומות/ }).fill("4");
  await dialog.getByRole("button", { name: "שמירה" }).click();
  // A new room opens its map (D20): a person has to take it or leave it before going on.
  const map = ownerPage.getByRole("dialog", { name: /מפת החדר/ });
  await expect(map).toBeVisible({ timeout: 15_000 });
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "room map dialog", "[role=dialog]");
  await map.getByRole("button", { name: "שמירה" }).click();
  await expect(map).toBeHidden({ timeout: 15_000 });
  await expect(ownerPage.getByText(roomName).first()).toBeVisible();

  // A class type.
  await goTo(ownerPage, "סוגי שיעורים", "סוגי שיעורים");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "class types");
  await ownerPage.getByRole("button", { name: "סוג שיעור חדש" }).first().click();
  dialog = ownerPage.getByRole("dialog", { name: "סוג שיעור חדש" });
  await dialog.getByRole("textbox", { name: /^שם/ }).fill(typeName);
  await dialog.getByRole("textbox", { name: /^משך בדקות/ }).fill("30");
  await dialog.getByRole("button", { name: "שמירה" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(ownerPage.getByText(typeName).first()).toBeVisible();

  // A punch-card product.
  await goTo(ownerPage, "כרטיסיות ומנויים", "כרטיסיות ומנויים");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "pass products");
  await ownerPage.getByRole("button", { name: "מוצר חדש" }).first().click();
  dialog = ownerPage.getByRole("dialog", { name: "מוצר חדש" });
  await dialog.getByRole("textbox", { name: /^שם/ }).fill(productName);
  await dialog.getByRole("textbox", { name: /^כניסות/ }).fill("5");
  await dialog.getByRole("textbox", { name: /^תוקף בימים/ }).fill("30");
  await dialog.getByRole("button", { name: "שמירה" }).click();
  await expect(ownerPage.getByText("המוצר נוסף")).toBeVisible();

  // The first weekly class, a few minutes ahead.
  await goTo(ownerPage, "מערכת שבועית", "מערכת שבועית");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "schedule");
  await ownerPage.getByRole("button", { name: "שיעור חדש" }).first().click();
  dialog = ownerPage.getByRole("dialog", { name: "שיעור חדש" });
  await dialog.getByRole("combobox", { name: /סוג שיעור/ }).selectOption({ label: typeName });
  await dialog.getByRole("combobox", { name: "חדר", exact: true }).selectOption({ label: roomName });
  const start = studioParts(new Date(Date.now() + classLeadMinutes * 60_000));
  classStart = start.time;
  const day = dialog.getByRole("textbox", { name: /^תאריך/ });
  await day.fill(ddmmyyyy(start.date));
  await day.press("Tab");
  await dialog.getByRole("combobox", { name: /שעת התחלה/ }).fill(start.time);
  await dialog.getByRole("combobox", { name: /שעת התחלה/ }).press("Tab");
  await expect(dialog.getByRole("checkbox", { name: "שיעור קבוע בכל שבוע" })).toBeChecked();
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "new class dialog", "[role=dialog]");
  await dialog.getByRole("button", { name: "יצירת השיעור" }).click();
  await expect(ownerPage.getByText("השיעור נוצר ונפתח להרשמה")).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  classStartsAt = Date.now() + (classLeadMinutes - 1) * 60_000;
  mark("a_first_weekly_class_saved");

  // The join link (Invitations).
  await goTo(ownerPage, "הזמנות", "הזמנות");
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "invitations and join link");
  await shot(ownerPage, "02-owner-invitations");
  await ownerPage.getByRole("button", { name: "יצירת קישור" }).click();
  const field = ownerPage.getByRole("textbox", { name: "קישור ההצטרפות החדש" });
  await expect(field).toBeVisible();
  joinLink = await field.inputValue();
  await ownerPage.getByRole("button", { name: "העתקה" }).click();
  expect(joinLink).toContain("/join#");
});

test("2. the member opens the join link, signs in, joins, gets a pass and books", async () => {
  const testInfo = test.info();
  // The link carries the app's own origin in production; the local run swaps in the local client app.
  const code = joinLink.split("#")[1]!;
  await memberPage.goto(`${clientUrl}/join#${code}`);
  await settle(memberPage);
  await expectNoSeriousA11yViolations(memberPage, testInfo, "join page, signed out");
  await memberPage
    .getByRole("button", { name: /התחברות/ })
    .first()
    .click();
  await hostedUi(memberPage, member, clientUrl);
  if (!memberPage.url().includes("/join")) await memberPage.goto(`${clientUrl}/join#${code}`);
  await settle(memberPage);
  await expectNoSeriousA11yViolations(memberPage, testInfo, "join page, signed in");
  await memberPage.getByRole("textbox", { name: /איך קוראים לך/ }).fill("e2e-p3 חברה");
  await memberPage.getByRole("button", { name: "הצטרפות", exact: true }).click();
  await memberPage.waitForURL((url) => !url.pathname.startsWith("/join"), { timeout: 30_000 });
  await settle(memberPage);
  mark("b_first_member_joined");
  await shot(memberPage, "03-member-after-join");
  await expectNoSeriousA11yViolations(memberPage, testInfo, "member home after joining");

  // The owner finds the new person and gives them the pass.
  await goTo(ownerPage, "אנשים", "אנשים");
  await shot(ownerPage, "03b-owner-people-list");
  await ownerPage
    .getByRole("link", { name: /e2e-p3 חברה/ })
    .first()
    .click();
  await expect(ownerPage.getByRole("heading", { level: 1 })).toBeVisible();
  await settle(ownerPage);
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "person card");
  await shot(ownerPage, "04-owner-person-card");
  await ownerPage.getByRole("button", { name: "מתן כרטיסייה או מנוי" }).click();
  const grant = ownerPage.getByRole("dialog", { name: /מתן כרטיסייה או מנוי ל/ });
  await grant.getByRole("combobox", { name: /^מוצר/ }).selectOption({ label: productName });
  await grant.getByRole("button", { name: "מתן", exact: true }).click();
  await expect(grant).toBeHidden({ timeout: 15_000 });

  // The member books from the timetable.
  expect(Date.now(), "the class started before the member could book it; raise classLeadMinutes").toBeLessThan(
    classStartsAt,
  );
  await memberPage
    .getByRole("link", { name: /שיעורים|מערכת/ })
    .first()
    .click();
  await settle(memberPage);
  await expectNoSeriousA11yViolations(memberPage, testInfo, "member timetable");
  await shot(memberPage, "05-member-timetable");
  await memberPage
    .getByRole("button", { name: new RegExp(`הרשמה לשיעור ${typeName} ב-${classStart}`) })
    .first()
    .click();
  const sheet = memberPage.getByRole("dialog", { name: new RegExp(`הרשמה לשיעור.*${typeName}`) });
  await expectNoSeriousA11yViolations(memberPage, testInfo, "booking sheet", "[role=dialog]");
  await sheet.getByRole("button", { name: "אישור ההרשמה" }).click();
  // P3 F7: the member should be told it worked, not only by the row's chip. In a room with a map no message shows
  // (#640), so the run records it; with that fix this becomes a plain expect.
  const told = await memberPage
    .getByText(/נרשמת לשיעור/)
    .waitFor({ timeout: 6_000 })
    .then(
      () => true,
      () => false,
    );
  if (!told) findings.push("#640: no booking confirmation on the timetable in a room with a map");
  await shot(memberPage, "05b-member-after-booking");
  await expect(memberPage.getByRole("listitem").filter({ hasText: typeName }).first()).toContainText("נרשמת");
});

test("3. the owner marks the member attended", async () => {
  const testInfo = test.info();
  await goTo(ownerPage, "מערכת שבועית", "מערכת שבועית");
  await ownerPage
    .getByRole("link", { name: new RegExp(typeName) })
    .first()
    .click();
  await expect(ownerPage.getByRole("heading", { level: 1, name: typeName })).toBeVisible();
  await settle(ownerPage);
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "class page with roster");
  await shot(ownerPage, "06-owner-class-roster");
  const roster = ownerPage.getByRole("region", { name: "משתתפים" });
  const present = roster.getByRole("button", { name: "הגיע.ה", exact: true });
  await present.click();
  await expect(present).toHaveAttribute("aria-pressed", "true");
  mark("c_first_attended_booking");
});

test("3b. the owner brings people and their passes over from the last system", async () => {
  const testInfo = test.info();
  // After mark c on purpose: a, b and c stay comparable with the runs before this step.
  const mail = (who: string) => `e2e-p3-${who}-${run}@example.com`;
  const until = studioParts(new Date(Date.now() + 60 * 86_400_000)).date;
  const csv = (name: string, lines: string[]) => ({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\r\n")),
  });

  await ownerPage.goto(admin("/people/import"));
  await ownerPage
    .getByLabel("בחירת קובץ")
    .setInputFiles(csv("people.csv", ["שם מלא,טלפון,מייל", `e2e-p3 אלף,,${mail("a")}`, `e2e-p3 בית,,${mail("b")}`]));
  await ownerPage.getByRole("button", { name: "בדיקת 2 השורות" }).click();
  await ownerPage.getByRole("button", { name: "ייבוא 2 אנשים" }).click();
  await expect(ownerPage.getByRole("heading", { name: "2 אנשים נוספו לסטודיו" })).toBeVisible({ timeout: 30_000 });

  await goTo(ownerPage, "כרטיסיות ומנויים", "כרטיסיות ומנויים");
  await ownerPage.getByRole("link", { name: "ייבוא כרטיסיות ומנויים" }).click();
  const date = `${until.slice(8, 10)}/${until.slice(5, 7)}/${until.slice(0, 4)}`;
  await ownerPage
    .getByLabel("בחירת קובץ")
    .setInputFiles(
      csv("passes.csv", [
        "מייל,טלפון,מוצר,כניסות שנותרו,בתוקף עד",
        `${mail("a")},,${productName},4,${date}`,
        `${mail("b")},,${productName},2,${date}`,
      ]),
    );
  await ownerPage.getByRole("button", { name: "בדיקת 2 השורות" }).click();
  const check = ownerPage.getByRole("region", { name: "הבדיקה" });
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "pass import check");
  await check.getByRole("button", { name: "ייבוא 2 כרטיסיות ומנויים" }).click();
  await expect(ownerPage.getByRole("heading", { name: "נוספו לסטודיו: 2 כרטיסיות ומנויים" })).toBeVisible({
    timeout: 30_000,
  });
  await shot(ownerPage, "07-owner-pass-import");
  mark("d_passes_imported");
});

test("4. the owner's screens fit a 390px phone", async ({ browser }) => {
  const testInfo = test.info();
  const context = await openScreen(browser, phone390);
  const page = await context.newPage();
  // Same user, a fresh browser: signing in again is part of the phone owner's day.
  await signIn(page, adminUrl, owner);
  await page.goto(admin("/"));
  const screens: [string, string, string][] = [
    ["הגדרות", "הגדרות הסטודיו", "settings"],
    ["חדרים", "חדרים", "rooms"],
    ["סוגי שיעורים", "סוגי שיעורים", "class types"],
    ["כרטיסיות ומנויים", "כרטיסיות ומנויים", "pass products"],
    ["מערכת שבועית", "מערכת שבועית", "schedule"],
    ["שיעורים קבועים", "שיעורים קבועים", "weekly classes"],
    ["הזמנות", "הזמנות", "invitations"],
    ["אנשים", "אנשים", "people"],
  ];
  for (const [label, heading, name] of screens) {
    await goTo(page, label, heading);
    const fit = await measureFit(page, phone390);
    annotateFit(testInfo, `${name} at 390px`, fit);
    expect.soft(fit.overflow, `${name} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
    await expectNoSeriousA11yViolations(page, testInfo, `${name} at 390px`);
  }
  await context.close();
});
