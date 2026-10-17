import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, aws, clientUrl, environment } from "../../support/env";
import { expectFitsNarrowPhone } from "../../support/phone";
import { studioDay, studioParts } from "../../support/studio";

/**
 * SYNC 6 (day board #253, Y3), on a phone (Pixel 7, both apps), against the dev API, with two fresh users and no
 * smoke user: an e2e owner opens a studio and adds a class that starts a few minutes later; an e2e member joins,
 * books it and is marked attended. A staff member without `reports.view` finds no reports in the console, and the
 * route and the API refuse them. Once the class has started, the owner's reports page shows that one visit and its
 * fill rate. Then the member deletes their login (A-1) and the person stays on the studio's roster with no login.
 *
 * The tests run in the order that keeps the wait short: the staff check (plan step 3) runs while the class starts,
 * before the report (plan step 2).
 *
 * Cleanup: the member deletes themselves through A-1. The owner can't (the only owner of the studio, which the
 * spec checks), so their Cognito user is deleted here, and the studio waits for the operator's cleanup (A-4).
 * Every name is `e2e-`, every email `e2e-…@example.com`; passwords live only in memory.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

interface User {
  email: string;
  password: string;
}

const run = Date.now().toString(36);
const newUser = (role: string): User => ({
  email: `e2e-sync6-${role}-${run}@example.com`,
  password: `Aa1!${randomBytes(18).toString("base64url")}`,
});
const owner = newUser("owner");
const member = newUser("member");
const studioName = `e2e-sync6 סטודיו ${run}`;
const slug = `e2e-sync6-${run}`;
const memberName = "e2e-sync6-member";
const typeName = "e2e-sync6-class";
const roomName = "e2e-sync6-room";
const productName = "e2e-sync6-card";
const capacity = 4;
/** Far enough ahead for the member to join and book before it starts (bookings close at the start). */
const classLeadMinutes = 6;
const roleIds = { staff: "00000000-0000-7000-8000-000000000003", client: "00000000-0000-7000-8000-000000000004" };

let poolId = "";
let ownerPage: Page;
let memberPage: Page;
let organizationId = "";
let sessionId = "";
let classStartsAt = 0;
let memberPersonId = "";

const admin = (path: string) => `${adminUrl}/o/${slug}${path}`;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** The Cognito CLI with its input in a temporary file, so a password never appears on a command line. */
function cognito(command: string, input: Record<string, unknown>): string | null {
  const dir = mkdtempSync(join(tmpdir(), "tempo-sync6-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return aws(["cognito-idp", command, "--cli-input-json", `file://${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const userExists = (user: User) => cognito("admin-get-user", { UserPoolId: poolId, Username: user.email }) !== null;

function createUser(user: User) {
  cognito("admin-create-user", {
    UserPoolId: poolId,
    Username: user.email,
    MessageAction: "SUPPRESS",
    UserAttributes: [
      { Name: "email", Value: user.email },
      { Name: "email_verified", Value: "true" },
    ],
  });
  cognito("admin-set-user-password", {
    UserPoolId: poolId,
    Username: user.email,
    Password: user.password,
    Permanent: true,
  });
  if (!userExists(user)) throw new Error(`Could not create the Cognito user ${user.email}.`);
}

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    storageState: { cookies: [], origins: [] },
  });
  return context.newPage();
}

/** The Hosted UI's form, when it shows one: a page that still has a Cognito session goes straight back. */
async function hostedUi(page: Page, user: User, app: string) {
  // Two copies of the form when the Hosted UI's CSS is late (see auth.setup.ts): wait for one, use the first shown.
  const form = page.locator('input[name="username"]:visible').first();
  const back = (url: URL) => url.origin === app && !url.pathname.startsWith("/auth/") && url.pathname !== "/login";
  // Whichever comes first; the other wait is dropped, so its timeout must not fail the test later.
  const shown = form.waitFor({ timeout: 30_000 });
  const returned = page.waitForURL(back, { timeout: 30_000 });
  shown.catch(() => undefined);
  returned.catch(() => undefined);
  await Promise.race([shown, returned]);
  if (await form.isVisible()) {
    const shownForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="username"]:visible') })
      .first();
    await shownForm.locator('input[name="username"]').fill(user.email);
    await shownForm.locator('input[name="password"]').fill(user.password);
    await shownForm.locator('input[name="signInSubmitButton"]').click();
  }
  await page.waitForURL(back, { timeout: 30_000 });
}

async function signIn(page: Page, app: string, user: User) {
  await page.goto(`${app}/login`);
  await page.getByRole("button", { name: "התחברות" }).click();
  await hostedUi(page, user, app);
}

/** A call to the dev API with the access token the page's app keeps (`tempo.<app>.session`). */
async function call<T = unknown>(
  page: Page,
  method: string,
  path: string,
  options: { data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const app = new URL(page.url()).origin === adminUrl ? "admin-web" : "client-web";
  const raw = await page.evaluate((key) => localStorage.getItem(key), `tempo.${app}.session`);
  const token = (JSON.parse(raw ?? "{}") as { accessToken?: string }).accessToken ?? "";
  const response = await page.request.fetch(`${process.env.E2E_API_URL}/api/v1${path}`, {
    method,
    data: options.data,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : undefined) as T };
}

/** The owner's call to the studio, failing loudly on any error. */
async function studio<T = unknown>(method: string, path: string, data?: unknown, headers?: Record<string, string>) {
  const answer = await call<T>(ownerPage, method, `/organizations/${organizationId}${path}`, { data, headers });
  expect(answer.status, `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBeLessThan(
    300,
  );
  return answer.body;
}

async function setMemberRole(role: keyof typeof roleIds) {
  const members = await studio<{ items: { id: string; email: string; version: string }[] }>("GET", "/members");
  const row = members.items.find((candidate) => candidate.email === member.email);
  if (!row) throw new Error("The e2e member is not on the members list.");
  await studio("PUT", `/members/${row.id}/roles`, { roleIds: [roleIds[role]] }, { "If-Match": row.version });
}

test.beforeAll(async ({ browser }) => {
  const stack = `Tempo${environment.charAt(0).toUpperCase()}${environment.slice(1)}-Identity`;
  poolId =
    aws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stack,
      "--query",
      "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]",
    ]) ?? "";
  test.skip(!poolId || !process.env.E2E_API_URL, "The dev user pool or API is not resolved: sign in to AWS first.");
  createUser(owner);
  createUser(member);
  ownerPage = await phone(browser);
  memberPage = await phone(browser);
});

test.afterAll(async () => {
  // The owner can't delete their login while the studio is theirs alone; the member normally has deleted theirs.
  for (const user of [owner, member]) {
    if (poolId && userExists(user)) {
      cognito("admin-delete-user", { UserPoolId: poolId, Username: user.email });
      console.log(`Deleted the Cognito user ${user.email}.`);
    }
  }
  if (organizationId) console.log(`Left on dev for the operator's cleanup (A-4): studio ${slug} (${organizationId}).`);
});

test("1. an e2e owner opens a studio and adds a class that starts in a few minutes (plan step 1)", async () => {
  await signIn(ownerPage, adminUrl, owner);
  await expect(ownerPage.getByRole("heading", { name: "פתיחת סטודיו חדש" })).toBeVisible();
  await ownerPage.getByRole("textbox", { name: /שם הסטודיו/ }).fill(studioName);
  await ownerPage.getByRole("textbox", { name: /כתובת/ }).fill(slug);
  await ownerPage.getByRole("button", { name: "פתיחת הסטודיו" }).click();
  await ownerPage.waitForURL((url) => url.pathname.startsWith(`/o/${slug}`), { timeout: 30_000 });
  const me = await call<{ memberships: { organization: { id: string; slug: string } }[] }>(ownerPage, "GET", "/me");
  organizationId = me.body.memberships.find((membership) => membership.organization.slug === slug)!.organization.id;

  // The setup the class needs, through the API; the class itself through the console.
  const policy = await studio<{ requireHealthDeclaration?: boolean; version: string }>("GET", "/booking-policy");
  if (policy.requireHealthDeclaration) {
    const { version, ...input } = policy;
    await studio("PUT", "/booking-policy", { ...input, requireHealthDeclaration: false }, { "If-Match": version });
  }
  await studio("POST", "/rooms", { name: roomName, defaultCapacity: capacity });
  await studio("POST", "/class-types", { name: typeName, category: "pilates", color: "sage", defaultMinutes: 30 });

  const start = studioParts(new Date(Date.now() + classLeadMinutes * 60_000));
  await ownerPage.goto(admin("/schedule"));
  await ownerPage.getByRole("button", { name: "שיעור חדש" }).first().click();
  const dialog = ownerPage.getByRole("dialog", { name: "שיעור חדש" });
  await dialog.getByRole("combobox", { name: /סוג שיעור/ }).selectOption({ label: typeName });
  await dialog.getByRole("combobox", { name: "חדר", exact: true }).selectOption({ label: roomName });
  const day = dialog.getByRole("textbox", { name: /^תאריך/ });
  await day.fill(ddmmyyyy(start.date));
  await day.press("Tab");
  await dialog.getByRole("combobox", { name: /שעת התחלה/ }).fill(start.time);
  await dialog.getByRole("combobox", { name: /שעת התחלה/ }).press("Tab");
  await expect(dialog.getByRole("textbox", { name: /מקומות/ })).toHaveValue(String(capacity));
  const weekly = dialog.getByRole("checkbox", { name: "שיעור קבוע בכל שבוע" });
  if (await weekly.isChecked()) await weekly.locator("xpath=ancestor::label[1]").click();
  await expect(weekly).not.toBeChecked();
  await dialog.getByRole("button", { name: "יצירת השיעור" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const sessions = await studio<{ items: { id: string; startsAt: string; classType: { name: string } }[] }>(
    "GET",
    `/sessions?from=${start.date}&to=${start.date}`,
  );
  const created = sessions.items.find((session) => session.classType.name === typeName);
  if (!created) throw new Error("The new class is not in the timetable.");
  sessionId = created.id;
  classStartsAt = Date.parse(created.startsAt);
});

test("2. the owner, the studio's only owner, can't delete their login yet, and the console says where to hand it over", async () => {
  const testInfo = test.info();
  await ownerPage.goto(`${adminUrl}/account/security`);
  const card = ownerPage.getByRole("region", { name: "מחיקת החשבון" });
  await expect(card).toBeVisible();
  // The console's account page, with its new last card (board "if ahead": axe and 320 px on the profile screens).
  await expectNoSeriousA11yViolations(ownerPage, testInfo, "console account page");
  await expectFitsNarrowPhone(ownerPage, testInfo, "console account page");
  await card.getByRole("button", { name: "מחיקת החשבון" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "מחיקת החשבון" });
  await dialog.getByRole("textbox", { name: /כתובת המייל של החשבון/ }).fill(owner.email);
  await dialog.getByRole("button", { name: "מחיקת החשבון" }).click();
  const handOver = dialog.getByRole("link", { name: `העברת הבעלות ב${studioName}` });
  await expect(handOver).toBeVisible();
  await expect(handOver).toHaveAttribute("href", `/o/${slug}`);
  await expectNoSeriousA11yViolations(
    ownerPage,
    testInfo,
    "console delete-account dialog, sole owner",
    "[role='dialog']",
  );
  await expectFitsNarrowPhone(ownerPage, testInfo, "console delete-account dialog, sole owner", "[role='dialog']");
  await dialog.getByRole("button", { name: "ביטול" }).click();
  // Still signed in, still the owner.
  expect((await call(ownerPage, "GET", "/me")).status).toBe(200);
});

test("3. an e2e member joins, books the class and is marked attended (plan step 1)", async () => {
  const product = await studio<{ id: string }>("POST", "/pass-products", {
    name: productName,
    kind: "punch_card",
    entries: 5,
    validDays: 30,
  });
  memberPersonId = (await studio<{ id: string }>("POST", "/people", { displayName: memberName, email: member.email }))
    .id;
  await studio("POST", `/people/${memberPersonId}/passes`, { productId: product.id, note: "e2e" });

  await ownerPage.goto(admin(`/people/${memberPersonId}`));
  await ownerPage.getByRole("button", { name: "הזמנה לאפליקציה" }).click();
  const invite = ownerPage.getByRole("dialog", { name: "הזמנה לאפליקציה" });
  await expect(invite.getByRole("textbox", { name: /מייל/ })).toHaveValue(member.email);
  await invite.getByRole("button", { name: "יצירת הזמנה" }).click();
  const link = await ownerPage.getByRole("textbox", { name: "קישור ההזמנה" }).inputValue();
  await ownerPage.getByRole("button", { name: "סיום" }).click();
  const memberLink = `${clientUrl}/invite#${link.split("#")[1]}`;

  await memberPage.goto(memberLink);
  await memberPage
    .getByRole("button", { name: /התחברות/ })
    .first()
    .click();
  await hostedUi(memberPage, member, clientUrl);
  if (!memberPage.url().includes("/invite")) await memberPage.goto(memberLink);
  await memberPage.getByRole("button", { name: "אישור ההצטרפות" }).click();
  await memberPage.waitForURL((url) => !url.pathname.startsWith("/invite"), { timeout: 30_000 });

  expect(Date.now(), "the class started before the member could book it; raise classLeadMinutes").toBeLessThan(
    classStartsAt - 30_000,
  );
  await memberPage.goto(`${clientUrl}/classes/${sessionId}`);
  await memberPage.getByRole("button", { name: /הרשמה/ }).first().click();
  await memberPage.getByRole("dialog").first().getByRole("button", { name: "אישור ההרשמה" }).click();
  await expect(memberPage.getByText(/^נרשמת לשיעור/).first()).toBeVisible();

  await ownerPage.goto(admin(`/schedule/sessions/${sessionId}`));
  const present = ownerPage
    .getByRole("region", { name: "משתתפים" })
    .getByRole("group", { name: `נוכחות של ${memberName}` })
    .getByRole("button", { name: "הגיע.ה", exact: true });
  await present.click();
  await expect(present).toHaveAttribute("aria-pressed", "true");
});

test("4. a staff member without reports.view finds no reports, and the route and the API refuse (plan step 3)", async () => {
  const testInfo = test.info();
  await setMemberRole("staff");
  try {
    await signIn(memberPage, adminUrl, member);
    await memberPage.goto(admin(""));
    // On a phone the console keeps its menu in a drawer (D15): the bottom bar, then the full menu.
    const bar = memberPage.getByRole("navigation", { name: "קיצורי דרך" });
    await expect(bar.getByRole("link", { name: "מערכת" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "דוחות" })).toHaveCount(0);
    await memberPage.getByRole("button", { name: "התפריט של הסטודיו" }).click();
    const nav = memberPage.getByRole("navigation", { name: "ניהול הסטודיו" });
    await expect(nav.getByRole("link", { name: "מערכת שבועית" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "דוחות" })).toHaveCount(0);
    await memberPage.keyboard.press("Escape");

    await memberPage.goto(admin("/reports"));
    await expect(memberPage.getByRole("heading", { level: 1, name: "אין לך גישה לדוחות" })).toBeVisible();
    await expectNoSeriousA11yViolations(memberPage, testInfo, "console reports, no access");
    await expectFitsNarrowPhone(memberPage, testInfo, "console reports, no access");

    const refused = await call<{ code: string }>(memberPage, "GET", `/organizations/${organizationId}/reports/summary`);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("permission.denied");
  } finally {
    await setMemberRole("client");
  }
});

test("5. once the class has started, the owner's reports page shows the one visit and the fill rate (plan step 2)", async () => {
  const testInfo = test.info();
  test.setTimeout(classLeadMinutes * 60_000 + 240_000);
  // A report counts a class from its start (docs/32 section 5).
  const wait = classStartsAt + 5_000 - Date.now();
  if (wait > 0) await ownerPage.waitForTimeout(wait);

  await ownerPage.goto(admin("/reports"));
  await expect(ownerPage.getByRole("heading", { level: 1, name: "דוחות" })).toBeVisible();
  // The phone's bottom bar (D15) marks the reports as the page on screen.
  await expect(
    ownerPage.getByRole("navigation", { name: "קיצורי דרך" }).getByRole("link", { name: "דוחות" }),
  ).toHaveAttribute("aria-current", "page");
  // The default period is the last four full weeks, before this studio existed.
  await expect(ownerPage.getByText("לא התקיימו שיעורים בתקופה הזאת.")).toBeVisible();

  const today = studioDay(0);
  await ownerPage.getByRole("button", { name: "תאריכים" }).click();
  for (const name of [/מתאריך/, /עד תאריך/]) {
    const input = ownerPage.getByRole("textbox", { name });
    await input.fill(ddmmyyyy(today));
    await input.press("Tab");
  }
  const tiles = ownerPage.getByRole("group", { name: "מדדי התקופה" });
  await expect(tiles.locator(".tp-kpi", { hasText: "ביקורים" }).locator(".tp-kpi__value")).toHaveText("1");
  const fill = `${Math.round((1 / capacity) * 100)}%`;
  await expect(tiles.locator(".tp-kpi", { hasText: "שיעור תפוסה" }).locator(".tp-kpi__value")).toHaveText(fill);
  const byType = ownerPage.getByRole("table", { name: "הנתונים לפי סוג שיעור" });
  const row = byType.getByRole("row", { name: typeName });
  await expect(row.getByRole("cell")).toHaveText(["1", "1", "1", "0", "0", fill]);
  // The chart's table (read by screen readers): this week's visits.
  await expect(
    ownerPage.getByRole("figure", { name: "ביקורים לפי שבוע" }).getByRole("row").last().getByRole("cell"),
  ).toHaveText("1");
  // Nobody's pass is ending and nobody is at risk in a studio a few minutes old; the lists still answer.
  await expect(ownerPage.getByText("אין כרטיסיות או מנויים שמסתיימים בקרוב.")).toBeVisible();
  await expect(ownerPage.getByText("כל מי שמחזיק כרטיסייה בתוקף הגיע בחודש האחרון.")).toBeVisible();

  await expectNoSeriousA11yViolations(ownerPage, testInfo, "console reports");
  await expectFitsNarrowPhone(ownerPage, testInfo, "console reports");
});

test("6. the member deletes their login, and the person stays on the studio's roster with no login (plan step 4)", async () => {
  const testInfo = test.info();
  await memberPage.goto(`${clientUrl}/profile`);
  await expect(memberPage.getByRole("button", { name: /מחיקת החשבון/ })).toBeVisible();
  await expectNoSeriousA11yViolations(memberPage, testInfo, "client-web profile");
  await expectFitsNarrowPhone(memberPage, testInfo, "client-web profile");
  const before = await call(memberPage, "GET", "/me");
  expect(before.status).toBe(200);
  const raw = await memberPage.evaluate(() => localStorage.getItem("tempo.client-web.session"));

  const confirm = async () => {
    await memberPage.getByRole("button", { name: /מחיקת החשבון/ }).click();
    const dialog = memberPage.getByRole("dialog", { name: "מחיקת החשבון" });
    await expect(dialog).toContainText("הרשומה שלך בסטודיו");
    await dialog.getByRole("textbox", { name: /כתובת המייל של החשבון/ }).fill(member.email);
    return dialog;
  };
  let dialog = await confirm();
  await expectNoSeriousA11yViolations(memberPage, testInfo, "client-web delete-account dialog", "[role='dialog']");
  await expectFitsNarrowPhone(memberPage, testInfo, "client-web delete-account dialog", "[role='dialog']");
  await dialog.getByRole("button", { name: "מחיקת החשבון" }).click();

  // A sign-in older than ten minutes asks for the password again first (step-up), then the deletion goes through.
  const signedOut = memberPage.waitForURL((url) => url.origin === clientUrl && url.pathname === "/login", {
    timeout: 30_000,
  });
  signedOut.catch(() => undefined);
  const stepUp = dialog.getByRole("button", { name: "התחברות מחדש" });
  const askedAgain = stepUp.waitFor({ timeout: 30_000 });
  askedAgain.catch(() => undefined);
  const first = await Promise.race([signedOut.then(() => "out" as const), askedAgain.then(() => "step-up" as const)]);
  if (first === "step-up") {
    await stepUp.click();
    await hostedUi(memberPage, member, clientUrl);
    await memberPage.goto(`${clientUrl}/profile`);
    dialog = await confirm();
    await dialog.getByRole("button", { name: "מחיקת החשבון" }).click();
    await memberPage.waitForURL((url) => url.origin === clientUrl && url.pathname === "/login", { timeout: 30_000 });
  } else {
    await signedOut;
  }

  // The old token no longer reaches an account, and the Cognito user is gone (AdminDeleteUser).
  const token = (JSON.parse(raw ?? "{}") as { accessToken?: string }).accessToken ?? "";
  const after = await memberPage.request.get(`${process.env.E2E_API_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([401, 404]).toContain(after.status());
  await expect.poll(() => userExists(member), { timeout: 30_000 }).toBe(false);

  // The studio keeps its record of the person, detached from any login.
  const person = await studio<{ status: string; hasLogin: boolean; displayName: string }>(
    "GET",
    `/people/${memberPersonId}`,
  );
  expect(person).toMatchObject({ status: "active", hasLogin: false, displayName: memberName });
  await ownerPage.goto(admin("/people"));
  await expect(ownerPage.getByRole("link", { name: memberName })).toBeVisible();
});
