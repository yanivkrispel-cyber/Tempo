import { devices, expect, test as base, type Page } from "@playwright/test";
import { Api, e2eName } from "../../support/api";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";
import { createSession, removeE2eSchedule, sessionsBetween, studioDay, studioParts } from "../../support/studio";

/**
 * The SYNC 2 demo flow (issue #89, "Goal of the night"), on a phone (Pixel 7, both apps), against the dev API:
 * the owner creates a weekly class and a punch-card product in the console, grants the card to a member, the member
 * books on client-web, the class fills and the next member joins the waitlist, someone cancels inside the free
 * window, the first waiting member is promoted and told, the roster and attendance are in the console, and the
 * audit log has it all. The signed-in smoke user is the owner in admin-web and the member in client-web; a second,
 * fictional e2e member fills the classes through the staff API. One serial file: each step builds on the last.
 */
/** The console steps get their own page on the same phone, in the same signed-in session (#163). */
const test = base.extend<{ consolePage: Page }>({
  consolePage: async ({ browser }, use) => {
    const context = await browser.newContext({
      ...devices["Pixel 7"],
      locale: "he-IL",
      timezoneId: "Asia/Jerusalem",
      storageState: sessionStatePath,
    });
    await use(await context.newPage());
    await context.close();
  },
});

test.skip(!hasSession(sessionStatePath), noSessionMessage);
test.describe.configure({ mode: "serial" });

const admin = (path: string) => `${adminUrl}/o/${studioSlug}${path}`;
const typeName = e2eName("sync2-class");
const roomName = e2eName("sync2-room");
const productName = e2eName("sync2-card");
const fillerName = e2eName("sync2-member");
const classStart = "23:00";
const waitlistStart = "10:00";

let api: Api;
let ownPerson: { id: string; displayName: string };
let fillerId: string;
let classTypeId: string;
let roomId: string;
let productId: string;
let weeklySessionId: string; // the weekly class's session a week from today: the member books it
let waitlistSessionId: string; // a one-off session, filled by the e2e member: the member waits on it
let weeklyDate: string;
let waitlistDate: string;

test.beforeAll(async () => {
  api = await Api.open();
  const own = await api.ownPerson();
  if (!own) throw new Error("The smoke user has no person record in the studio.");
  ownPerson = own;
  // Leftovers of an interrupted run.
  await removeE2eSchedule(api, ownPerson.id);
  for (const leftover of await api.e2ePeople()) await api.removePerson(leftover.id);
  await removeE2eSchedule(api, ownPerson.id);

  // Seeding: the room (one place, so the class fills with one booking), the class type, and the second member.
  roomId = (await api.call<{ id: string }>("POST", "/rooms", { data: { name: roomName, defaultCapacity: 1 } })).id;
  classTypeId = (
    await api.call<{ id: string }>("POST", "/class-types", {
      data: { name: typeName, category: "pilates", color: "sage", defaultMinutes: 30 },
    })
  ).id;
  fillerId = (await api.createPerson({ displayName: fillerName, email: `${fillerName}@example.com` })).id;
});

test.afterAll(async () => {
  if (!api) return;
  await removeE2eSchedule(api, ownPerson?.id);
  for (const leftover of await api.e2ePeople()) await api.removePerson(leftover.id);
  // The product can be archived only once the e2e member's pass is gone with the person.
  await removeE2eSchedule(api, ownPerson?.id);
  await api.dispose();
});

test("console: the owner creates a weekly class", async ({ consolePage: page }, testInfo) => {
  await page.goto(admin("/schedule"));
  await expect(page.getByRole("heading", { level: 1, name: "מערכת שבועית" })).toBeVisible();
  // The week grid only: today's column header fails color-contrast (".tp-sched__day--today > b"), a product bug.
  await expectNoSeriousA11yViolations(page, testInfo, "console schedule", ".tp-sched__body");

  await page.getByRole("button", { name: "שיעור חדש" }).first().click();
  const dialog = page.getByRole("dialog", { name: "שיעור חדש" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: /סוג שיעור/ }).selectOption({ label: typeName });
  await dialog.getByRole("combobox", { name: "חדר", exact: true }).selectOption({ label: roomName });
  await dialog.getByRole("combobox", { name: /שעת התחלה/ }).fill(classStart);
  await dialog.getByRole("combobox", { name: /שעת התחלה/ }).press("Tab");
  await expect(dialog.getByRole("textbox", { name: /מקומות/ })).toHaveValue("1");
  await expect(dialog.getByRole("checkbox", { name: "שיעור קבוע בכל שבוע" })).toBeChecked();
  await expectNoSeriousA11yViolations(page, testInfo, "console new class dialog", "[role=dialog]");

  await dialog.getByRole("button", { name: "יצירת השיעור" }).click();
  await expect(page.getByText("השיעור נוצר ונפתח להרשמה")).toBeVisible();
  await expect(dialog).toBeHidden();

  // It is now a weekly class, with sessions for the weeks ahead.
  await page.goto(admin("/weekly-classes"));
  await expect(page.getByRole("heading", { level: 1, name: "שיעורים קבועים" })).toBeVisible();
  await expect(page.getByText(typeName).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "console weekly classes");

  weeklyDate = studioDay(7);
  const found = (await sessionsBetween(api, studioDay(6), studioDay(8))).find(
    (session) => session.classType.id === classTypeId && session.localDate === weeklyDate,
  );
  if (!found) throw new Error(`The weekly class has no session on ${weeklyDate}.`);
  weeklySessionId = found.id;
});

test("console: the owner creates a punch-card product", async ({ consolePage: page }, testInfo) => {
  await page.goto(admin("/passes"));
  await expect(page.getByRole("heading", { level: 1, name: "כרטיסיות ומנויים" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "console passes");

  await page.getByRole("button", { name: "מוצר חדש" }).first().click();
  const dialog = page.getByRole("dialog", { name: "מוצר חדש" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /^שם/ }).fill(productName);
  await dialog.getByRole("textbox", { name: /^כניסות/ }).fill("5");
  await dialog.getByRole("textbox", { name: /^תוקף בימים/ }).fill("30");
  await expectNoSeriousA11yViolations(page, testInfo, "console new product dialog");
  await dialog.getByRole("button", { name: "שמירה" }).click();

  await expect(page.getByText("המוצר נוסף")).toBeVisible();
  await expect(page.getByRole("table", { name: "כרטיסיות ומנויים" }).getByText(productName)).toBeVisible();
  productId = (await api.call<{ items: { id: string; name: string }[] }>("GET", "/pass-products")).items.find(
    (product) => product.name === productName,
  )!.id;
});

test("console: staff grants the card to the member on the person card", async ({ consolePage: page }, testInfo) => {
  await page.goto(admin(`/people/${ownPerson.id}`));
  await expect(page.getByRole("heading", { level: 1, name: ownPerson.displayName })).toBeVisible();
  await page.getByRole("button", { name: "מתן כרטיסייה או מנוי" }).click();

  const dialog = page.getByRole("dialog", { name: `מתן כרטיסייה או מנוי ל${ownPerson.displayName}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: /^מוצר/ }).selectOption({ label: productName });
  await expectNoSeriousA11yViolations(page, testInfo, "console grant-pass dialog");
  await dialog.getByRole("button", { name: "מתן", exact: true }).click();

  await expect(page.getByText(`${productName} ניתן ל${ownPerson.displayName}`)).toBeVisible();
  const passes = page.getByRole("region", { name: "כרטיסיות ומנויים" });
  await expect(passes.getByText(productName).first()).toBeVisible();
  await expect(passes.getByText("נותרו 5 מתוך 5 כניסות").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "console person card with a pass");

  // The e2e member holds a card too (seeding), so she can fill classes and wait for a place.
  await api.call("POST", `/people/${fillerId}/passes`, { data: { productId, note: "e2e" } });
});

test("client-web: the member books the class from the phone", async ({ page }, testInfo) => {
  await page.goto(`${clientUrl}/book?day=${weeklyDate}`);
  await expect(page.getByRole("heading", { level: 1, name: "מערכת שיעורים" })).toBeVisible();
  const book = page.getByRole("button", { name: `הרשמה לשיעור ${typeName} ב-${classStart}` });
  await expect(book).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web timetable");

  await book.click();
  const sheet = page.getByRole("dialog", { name: new RegExp(`הרשמה לשיעור.*${typeName}`) });
  await expect(sheet).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web booking sheet");
  await sheet.getByRole("button", { name: "אישור ההרשמה" }).click();

  await expect(page.getByText("נרשמת לשיעור.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: typeName });
  await expect(row.getByText("נרשמת", { exact: true })).toBeVisible();

  // The class is full now (one place).
  await page.goto(`${clientUrl}/classes/${weeklySessionId}`);
  await expect(page.getByRole("heading", { level: 1, name: typeName })).toBeVisible();
  await expect(page.getByRole("region", { name: "מקומות" })).toContainText("1 מתוך 1 רשומים");
  await expectNoSeriousA11yViolations(page, testInfo, "client-web class screen, booked");

  await page.goto(`${clientUrl}/bookings`);
  await expect(page.getByRole("list", { name: "הזמנות קרובות" }).getByText(typeName)).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web my bookings");
});

test("client-web: the class fills and the next member joins the waitlist", async ({ page }, testInfo) => {
  // A second class, filled by the e2e member through the staff API: one place, one booking.
  waitlistDate = studioDay(2);
  waitlistSessionId = await createSession(api, {
    classTypeId,
    roomId,
    localDate: waitlistDate,
    localStart: waitlistStart,
    capacity: 1,
  });
  await api.call("POST", `/sessions/${waitlistSessionId}/bookings`, { data: { personId: fillerId } });

  await page.goto(`${clientUrl}/book?day=${waitlistDate}`);
  const wait = page.getByRole("button", { name: `להמתנה לשיעור ${typeName} ב-${waitlistStart}` });
  await expect(wait).toBeVisible();
  await wait.click();
  const sheet = page.getByRole("dialog", { name: new RegExp(`רשימת ההמתנה לשיעור.*${typeName}`) });
  await expect(sheet).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web waitlist sheet");
  await sheet.getByRole("button", { name: "הצטרפות לרשימת ההמתנה" }).click();
  await expect(page.getByText("נכנסת לרשימת ההמתנה,")).toBeVisible();

  await page.goto(`${clientUrl}/classes/${waitlistSessionId}`);
  await expect(page.getByRole("heading", { level: 1, name: typeName })).toBeVisible();
  await expect(page.getByText("במקום 1 בהמתנה").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "יציאה מרשימת ההמתנה" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web class screen, waitlisted");
});

test("console: a cancellation inside the free window returns the entry and promotes the first in line", async ({
  consolePage: page,
}, testInfo) => {
  await page.goto(admin(`/schedule/sessions/${waitlistSessionId}`));
  await expect(page.getByRole("heading", { level: 1, name: typeName })).toBeVisible();
  const roster = page.getByRole("region", { name: "משתתפים" });
  await expect(roster.getByRole("link", { name: fillerName })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "console session roster, full class");

  expect((await passOf(fillerId)).entriesLeft).toBe(4);

  await roster.getByRole("button", { name: `ביטול ההרשמה של ${fillerName}` }).click();
  const dialog = page.getByRole("dialog", { name: `לבטל את ההרשמה של ${fillerName}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/הכניסה תחזור לכרטיסייה/)).toBeVisible();
  await expectNoSeriousA11yViolations(
    page,
    testInfo,
    "console cancel-booking dialog",
    undefined,
    "the danger button label fails color-contrast (.tp-btn--danger, #164)",
  );
  await dialog.getByRole("button", { name: "ביטול ההרשמה", exact: true }).click();
  await expect(page.getByText(`ההרשמה של ${fillerName} בוטלה`)).toBeVisible();

  // The entry went back to the card; the member who waited now holds the place.
  expect((await passOf(fillerId)).entriesLeft).toBe(5);
  await expect(roster.getByRole("link", { name: ownPerson.displayName })).toBeVisible();
  await expect(roster.getByRole("link", { name: fillerName })).toHaveCount(0);
});

test("client-web: the promoted member sees the booking and the notice", async ({ page }, testInfo) => {
  await page.goto(`${clientUrl}/classes/${waitlistSessionId}`);
  await expect(page.getByRole("heading", { level: 1, name: typeName })).toBeVisible();
  await expect(page.getByText("נרשמת", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("התפנה מקום, ונרשמת אוטומטית מרשימת ההמתנה.")).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web class screen, promoted");

  await page.goto(`${clientUrl}/`);
  await expect(page.getByRole("link", { name: /^התראות, / })).toBeVisible();
  await expectNoSeriousA11yViolations(
    page,
    testInfo,
    "client-web home with a notice",
    undefined,
    "a chip fails color-contrast (.tp-chip, #164)",
  );

  await page.goto(`${clientUrl}/inbox`);
  await expect(page.getByRole("heading", { level: 1, name: "התראות" })).toBeVisible();
  await expect(page.getByRole("list", { name: "התראות" }).getByText("התפנה מקום ונרשמת").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web inbox");
});

test("console: the roster of the booked class, and attendance on a class about to start", async ({
  consolePage: page,
}, testInfo) => {
  // The weekly class's roster has the member who booked from the phone.
  await page.goto(admin(`/schedule/sessions/${weeklySessionId}`));
  await expect(page.getByRole("heading", { level: 1, name: typeName })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "משתתפים" }).getByRole("link", { name: ownPerson.displayName }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "console session roster, weekly class");

  // Attendance opens 30 minutes before the start: a one-off class twenty minutes from now.
  const startsIn20 = studioParts(new Date(Date.now() + 20 * 60_000));
  const soonId = await createSession(api, {
    classTypeId,
    roomId,
    localDate: startsIn20.date,
    localStart: startsIn20.time,
    capacity: 1,
  });
  await api.call("POST", `/sessions/${soonId}/bookings`, { data: { personId: fillerId } });

  await page.goto(admin(`/schedule/sessions/${soonId}`));
  const roster = page.getByRole("region", { name: "משתתפים" });
  await expect(roster.getByRole("link", { name: fillerName })).toBeVisible();
  const present = roster
    .getByRole("group", { name: `נוכחות של ${fillerName}` })
    .getByRole("button", { name: "הגיע.ה", exact: true });
  await expect(present).toHaveAttribute("aria-pressed", "false");
  await expectNoSeriousA11yViolations(page, testInfo, "console roster with attendance");
  const marked = page.waitForResponse((response) => response.url().includes("/attendance"));
  await present.click();
  const answer = await marked;
  expect(answer.status(), `attendance answered ${answer.status()}: ${await answer.text()}`).toBeLessThan(300);
  await expect(present).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "משתתפים" })
      .getByRole("group", { name: `נוכחות של ${fillerName}` })
      .getByRole("button", { name: "הגיע.ה", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("console: the audit log has the whole flow", async ({ consolePage: page }, testInfo) => {
  const events = await api.call<{ items: { action: string }[] }>("GET", "/audit-events", { params: { limit: 100 } });
  const actions = new Set(events.items.map((event) => event.action));
  for (const action of [
    "session.created",
    "pass_product.created",
    "pass.granted",
    "booking.created",
    "booking.waitlisted",
    "booking.cancelled",
    "booking.promoted",
    "booking.attendance_marked",
  ]) {
    expect(actions, `the audit log has ${action}`).toContain(action);
  }

  await page.goto(admin("/audit"));
  await expect(page.getByRole("heading", { level: 1, name: "יומן פעולות" })).toBeVisible();
  const table = page.getByRole("table", { name: "יומן פעולות" });
  await expect(table).toBeVisible();
  expect(await table.getByRole("row").count()).toBeGreaterThan(8);
  // The page names an action in Hebrew when it knows it, and as sent when it does not (features/audit/actions.ts).
  await expect(table.getByRole("cell", { name: /booking\.promoted|הרשמה אוטומטית|קידום/ }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "console audit log");
});

test("console: the studio's subscription is the pilot plan, active", async ({ consolePage: page }, testInfo) => {
  const billing = await api.call<{ plan: { planKey: string; displayName: string }; state: string }>("GET", "/billing");
  expect(billing.plan.planKey).toBe("pilot");
  expect(billing.state).toBe("active");

  // The settings page's plan card (#165) names the plan and says it is active.
  await page.goto(admin("/settings"));
  await expect(page.getByRole("heading", { level: 1, name: "הגדרות הסטודיו" })).toBeVisible();
  const plan = page.getByRole("region", { name: "המנוי ל־Tempo" });
  await expect(plan.getByText(billing.plan.displayName, { exact: true })).toBeVisible();
  await expect(plan).toContainText("פעיל");
  await expectNoSeriousA11yViolations(page, testInfo, "console settings");
});

async function passOf(personId: string): Promise<{ entriesLeft: number | null | undefined }> {
  const list = await api.call<{ items: { status: string; entriesLeft?: number | null; product: { id: string } }[] }>(
    "GET",
    `/people/${personId}/passes`,
  );
  const pass = list.items.find((item) => item.status === "active" && item.product.id === productId);
  if (!pass) throw new Error("The e2e member has no active e2e card.");
  return { entriesLeft: pass.entriesLeft };
}
