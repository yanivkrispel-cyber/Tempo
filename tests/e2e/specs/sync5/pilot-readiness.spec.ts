import { devices, expect, test as base, type Page } from "@playwright/test";
import { Api, e2eName } from "../../support/api";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";
import { expectFitsNarrowPhone } from "../../support/phone";
import { createSession, removeE2eSchedule, studioDay, studioParts } from "../../support/studio";

/**
 * SYNC 5 (day board #232, X4), on a phone (Pixel 7, both apps), against the dev API: the member signs the health
 * declaration with a "yes", staff see the status and the owner opens the answers (an audited read); with the booking
 * gate on, the member's own booking is refused while staff can still book an unsigned e2e member; the owner records
 * the medical approval and the member books; the gate goes back off. Then the member sets a monthly goal and the
 * home's numbers follow an attendance the studio marks.
 *
 * The signed-in smoke user is the owner in admin-web and the member in client-web. Its declaration stays on dev (a
 * declaration is removed only with the person), answered with the generic draft questions: no real health data.
 * Everything else is `e2e-` and removed afterwards; the gate and the goal go back to what they were.
 */
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

type Policy = {
  freeCancelHours: number;
  waitlistCutoffHours: number;
  bookingHorizonDays: number;
  waitlistEnabled: boolean;
  requireHealthDeclaration?: boolean;
  version: string;
};
type Progress = { visitsThisMonth: number; monthlyGoal: number | null; streakWeeks: number };

const admin = (path: string) => `${adminUrl}/o/${studioSlug}${path}`;
const typeName = e2eName("sync5-class");
const roomName = e2eName("sync5-room");
const productName = e2eName("sync5-card");
const walkInName = e2eName("sync5-member");
const signerName = e2eName("sync5-signer");
const gateStart = "21:00";

let api: Api;
let ownPerson: { id: string; displayName: string };
let classTypeId: string;
let roomId: string;
let walkInId: string;
let gateSessionId: string;
let savedGate = false;
let savedGoal: number | null = null;

async function setGate(on: boolean): Promise<void> {
  const policy = await api.call<Policy>("GET", "/booking-policy");
  if ((policy.requireHealthDeclaration ?? false) === on) return;
  const { version, ...input } = policy;
  await api.call("PUT", "/booking-policy", {
    data: { ...input, requireHealthDeclaration: on },
    headers: { "If-Match": version },
  });
}

test.beforeAll(async () => {
  api = await Api.open();
  const own = await api.ownPerson();
  if (!own) throw new Error("The smoke user has no person record in the studio.");
  ownPerson = own;
  // Leftovers of an interrupted run.
  await removeE2eSchedule(api, ownPerson.id);
  for (const leftover of await api.e2ePeople()) await api.removePerson(leftover.id);
  await removeE2eSchedule(api, ownPerson.id);

  savedGate = (await api.call<Policy>("GET", "/booking-policy")).requireHealthDeclaration ?? false;
  savedGoal = (await api.call<Progress>("GET", "/me/progress")).monthlyGoal;
  await setGate(false);

  roomId = (await api.call<{ id: string }>("POST", "/rooms", { data: { name: roomName, defaultCapacity: 4 } })).id;
  classTypeId = (
    await api.call<{ id: string }>("POST", "/class-types", {
      data: { name: typeName, category: "pilates", color: "sage", defaultMinutes: 30 },
    })
  ).id;
  const product = await api.call<{ id: string }>("POST", "/pass-products", {
    data: { name: productName, kind: "punch_card", entries: 5, validDays: 30 },
  });
  await api.call("POST", `/people/${ownPerson.id}/passes`, { data: { productId: product.id, note: "e2e" } });
  walkInId = (await api.createPerson({ displayName: walkInName, email: `${walkInName}@example.com` })).id;
  await api.call("POST", `/people/${walkInId}/passes`, { data: { productId: product.id, note: "e2e" } });
  gateSessionId = await createSession(api, {
    classTypeId,
    roomId,
    localDate: studioDay(1),
    localStart: gateStart,
    capacity: 4,
  });
});

test.afterAll(async () => {
  if (!api) return;
  await setGate(savedGate).catch(() => undefined);
  await api.call("PUT", "/me/progress/goal", { data: { monthlyGoal: savedGoal } }).catch(() => undefined);
  await removeE2eSchedule(api, ownPerson?.id);
  for (const leftover of await api.e2ePeople()) await api.removePerson(leftover.id);
  await removeE2eSchedule(api, ownPerson?.id);
  await api.dispose();
});

test("client-web: the member signs the declaration, answering one question yes", async ({ page }, testInfo) => {
  await page.goto(`${clientUrl}/profile/health`);
  await expect(page.getByRole("heading", { level: 1, name: "הצהרת בריאות" })).toBeVisible();
  const status = page.getByRole("region", { name: /המצב שלך/ });
  await expect(status).toBeVisible();
  // A run before this one signed already: sign again, which replaces it.
  const update = status.getByRole("button", { name: "עדכון ההצהרה" });
  if (await update.isVisible()) await update.click();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web declaration form");
  await expectFitsNarrowPhone(page, testInfo, "client-web declaration form");

  const questions = page.getByRole("group", { name: "שאלות ההצהרה" }).getByRole("group");
  const count = await questions.count();
  expect(count).toBeGreaterThan(0);
  // By keyboard, as a member with a screen reader would: each answer, once focused, is visible and not under the
  // fixed tab bar (WCAG 2.4.11; the design system's scroll padding).
  for (let index = 0; index < count; index++) {
    const radio = questions.nth(index).getByRole("radio", { name: index === 0 ? "כן" : "לא" });
    await radio.focus();
    await page.keyboard.press("Space");
    await expect(radio).toBeChecked();
    const covered = await radio.evaluate((input) => {
      const box = input.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !(top === input || input.parentElement?.contains(top));
    });
    expect(covered, `question ${index + 1}'s answer is hidden behind something when focused`).toBe(false);
  }
  await page.getByRole("textbox", { name: /^שם מלא/ }).fill(signerName);
  await page.getByRole("checkbox", { name: /קראתי את השאלות/ }).check();
  await page.getByRole("button", { name: "חתימה ושליחה" }).click();

  await expect(page.getByText("ההצהרה נשמרה. לפני השיעור הראשון צריך להביא אישור רפואי.").first()).toBeVisible();
  await expect(status.getByText("ממתינה לאישור רפואי")).toBeVisible();
  await expect(status).toContainText("צריך להביא לסטודיו אישור רפואי");
  await expectNoSeriousA11yViolations(page, testInfo, "client-web declaration status");
  await expectFitsNarrowPhone(page, testInfo, "client-web declaration status");

  await page.goto(`${clientUrl}/profile`);
  await expect(page.getByRole("link", { name: /הצהרת בריאות/ }).getByText("ממתינה לאישור רפואי")).toBeVisible();
});

test("console: staff see the status; the owner opens the answers, and that read is audited", async ({
  consolePage: page,
}, testInfo) => {
  await page.goto(admin(`/people/${ownPerson.id}`));
  const section = page.getByRole("region", { name: "הצהרת בריאות" });
  await expect(section.getByText("ממתינה לאישור רפואי")).toBeVisible();
  await expectNoSeriousA11yViolations(
    page,
    testInfo,
    "console person health section",
    "section[aria-labelledby='health']",
  );

  const before = await api.call<{ items: { action: string }[] }>("GET", "/audit-events", { params: { limit: 100 } });
  const viewsBefore = before.items.filter((event) => event.action === "health.declaration.viewed").length;

  await section.getByRole("button", { name: "הצגת התשובות" }).click();
  const dialog = page.getByRole("dialog", { name: /^התשובות של/ });
  await expect(dialog.getByRole("group", { name: "התשובות" })).toBeVisible();
  await expect(dialog).toContainText(signerName);
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page, testInfo, "console answers dialog", "[role='dialog']");
  await expectFitsNarrowPhone(page, testInfo, "console answers dialog", "[role='dialog']");
  await dialog.getByRole("button", { name: "סגירה" }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => {
      const after = await api.call<{ items: { action: string; data?: unknown }[] }>("GET", "/audit-events", {
        params: { limit: 100 },
      });
      return after.items.filter((event) => event.action === "health.declaration.viewed").length;
    })
    .toBe(viewsBefore + 1);
  // The event carries no content: the signer's name is nowhere in the audit log.
  const events = await api.call<{ items: unknown[] }>("GET", "/audit-events", { params: { limit: 100 } });
  expect(JSON.stringify(events)).not.toContain(signerName);
});

test("gate on: the member's own booking is refused with a way to the form; staff can still book an unsigned member", async ({
  page,
  consolePage,
}, testInfo) => {
  await consolePage.goto(admin("/settings"));
  const gate = consolePage
    .getByRole("region", { name: "הרשמה לשיעורים" })
    .getByRole("switch", { name: "הרשמה רק עם הצהרת בריאות חתומה" });
  await expect(gate).not.toBeChecked();
  await expectNoSeriousA11yViolations(
    consolePage,
    testInfo,
    "console booking-policy card",
    "section[aria-labelledby='booking-policy']",
  );
  await gate.locator("xpath=ancestor::label[1]").click();
  await expect(consolePage.getByText("מעכשיו הרשמה לשיעור דורשת הצהרת בריאות חתומה").first()).toBeVisible();
  await expect(gate).toBeChecked();

  await page.goto(`${clientUrl}/book?day=${studioDay(1)}`);
  await page.getByRole("button", { name: `הרשמה לשיעור ${typeName} ב-${gateStart}` }).click();
  const sheet = page.getByRole("dialog", { name: `הרשמה לשיעור ${typeName}` });
  await sheet.getByRole("button", { name: "אישור ההרשמה" }).click();
  await expect(sheet.getByText(/הסטודיו מבקש הצהרת בריאות חתומה לפני ההרשמה לשיעורים/)).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web booking refused by the gate", "[role='dialog']");
  await expectFitsNarrowPhone(page, testInfo, "client-web booking refused by the gate", "[role='dialog']");
  await sheet.getByRole("link", { name: "למילוי הצהרת הבריאות" }).click();
  await expect(page).toHaveURL(/\/profile\/health$/);

  // Staff booking someone without a declaration is not blocked, and it is audited.
  await api.call("POST", `/sessions/${gateSessionId}/bookings`, { data: { personId: walkInId } });
  const events = await api.call<{ items: { action: string }[] }>("GET", "/audit-events", { params: { limit: 50 } });
  expect(events.items.some((event) => event.action === "booking.health_gate_bypassed")).toBe(true);

  // The roster marks the unsigned member for the front desk.
  await consolePage.goto(admin(`/schedule/sessions/${gateSessionId}`));
  const roster = consolePage.getByRole("region", { name: "משתתפים" });
  const row = roster.getByRole("listitem").filter({ hasText: walkInName });
  await expect(row.getByText("חסרה")).toBeVisible();
  await expectNoSeriousA11yViolations(consolePage, testInfo, "console roster with a health mark");
});

test("console and client-web: the owner records the medical approval, the member books, the gate goes off", async ({
  page,
  consolePage,
}, testInfo) => {
  await consolePage.goto(admin(`/people/${ownPerson.id}`));
  const section = consolePage.getByRole("region", { name: "הצהרת בריאות" });
  await section.getByRole("button", { name: "רישום אישור רפואי" }).click();
  const dialog = consolePage.getByRole("dialog", { name: "רישום אישור רפואי" });
  await expectNoSeriousA11yViolations(consolePage, testInfo, "console medical approval dialog", "[role='dialog']");
  await dialog.getByRole("button", { name: "רישום" }).click();
  await expect(consolePage.getByText("האישור הרפואי נרשם").first()).toBeVisible();
  await expect(section.getByText("הצהרת בריאות חתומה")).toBeVisible();

  await page.goto(`${clientUrl}/book?day=${studioDay(1)}`);
  await page.getByRole("button", { name: `הרשמה לשיעור ${typeName} ב-${gateStart}` }).click();
  const sheet = page.getByRole("dialog", { name: `הרשמה לשיעור ${typeName}` });
  await sheet.getByRole("button", { name: "אישור ההרשמה" }).click();
  await expect(page.getByText(/^נרשמת לשיעור/).first()).toBeVisible();

  await consolePage.goto(admin("/settings"));
  const gate = consolePage
    .getByRole("region", { name: "הרשמה לשיעורים" })
    .getByRole("switch", { name: "הרשמה רק עם הצהרת בריאות חתומה" });
  await gate.locator("xpath=ancestor::label[1]").click();
  await expect(consolePage.getByText("ההרשמה לשיעורים כבר לא דורשת הצהרת בריאות").first()).toBeVisible();
  await expect(gate).not.toBeChecked();
});

test("client-web: a monthly goal, and the home's numbers follow an attendance the studio marks", async ({
  page,
}, testInfo) => {
  const before = await api.call<Progress>("GET", "/me/progress");

  await page.goto(`${clientUrl}/profile`);
  await page.getByRole("button", { name: /יעד חודשי/ }).click();
  const dialog = page.getByRole("dialog", { name: "יעד חודשי" });
  await expectNoSeriousA11yViolations(page, testInfo, "client-web goal dialog", "[role='dialog']");
  await expectFitsNarrowPhone(page, testInfo, "client-web goal dialog", "[role='dialog']");
  await dialog.getByRole("spinbutton", { name: /שיעורים בחודש/ }).fill("20");
  await dialog.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("button", { name: /יעד חודשי/ })).toContainText("20 שיעורים בחודש");

  // A class twenty minutes from now (attendance opens thirty minutes before), booked by staff and marked attended.
  const soon = studioParts(new Date(Date.now() + 20 * 60_000));
  test.skip(soon.date.slice(0, 7) !== studioDay(0).slice(0, 7), "The class would start next month.");
  const soonId = await createSession(api, {
    classTypeId,
    roomId,
    localDate: soon.date,
    localStart: soon.time,
    capacity: 2,
  });
  const booking = await api.call<{ id: string }>("POST", `/sessions/${soonId}/bookings`, {
    data: { personId: ownPerson.id },
  });
  await api.call("POST", `/bookings/${booking.id}/attendance`, { data: { state: "attended" } });

  await page.goto(clientUrl);
  const stats = page.getByRole("region", { name: "ההתקדמות שלך" });
  const visits = before.visitsThisMonth + 1;
  await expect(stats.getByRole("progressbar", { name: `ביקורים החודש: ${visits} מתוך יעד של 20` })).toBeVisible();
  await expect(stats).toContainText(/ברצף/);
  await expectNoSeriousA11yViolations(page, testInfo, "client-web home with progress");
  await expectFitsNarrowPhone(page, testInfo, "client-web home with progress");

  const after = await api.call<Progress>("GET", "/me/progress");
  expect(after.visitsThisMonth).toBe(visits);
  expect(after.streakWeeks).toBeGreaterThanOrEqual(1);
});
