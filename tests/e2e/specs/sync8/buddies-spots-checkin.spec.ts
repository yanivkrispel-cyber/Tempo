import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createUser, deleteUser, hostedUi, newUser, ok, signIn, userPoolId } from "../../support/accounts";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl } from "../../support/env";
import { keepScreenshot, measureFit, openScreen, SCREENS, settle, type Screen } from "../../support/screens";
import { studioParts } from "../../support/studio";

/**
 * SYNC 8, E10 (day board #347, O4; docs/33 section 13), against the dev API and the dev sites, with three fresh users
 * and no smoke user: the owner at a computer (1280px) and two members on a phone (360px), D15.
 * 1. The owner opens a studio with a room of six reformers, a class that starts in 15 minutes, and a punch card for
 *    each member; both members join through their invitations.
 * 2. Maya makes a buddy code in her profile; Noa types it in hers, and the two are buddies.
 * 3. Maya books reformer 1. Noa sees her buddy on the room map and books reformer 2, next to her.
 * 4. Noa opens her entry pass. Staff check her in with her code (the code path: Playwright has no camera, so the code
 *    the member app shows goes to POST /checkins, as the scanner sends it), and the live map shows her arrival.
 * 5. The owner's today page shows the month's sales, the week's occupancy and the check-in; the search finds Noa, at
 *    1280 and at 360.
 * axe runs on every screen, and each is kept as a screenshot with E2E_SCREENSHOTS=1.
 *
 * Cleanup: the three Cognito users are deleted here; the studio waits for the operator's cleanup (A-4). Every name is
 * `e2e-`, every email `e2e-…@example.com`.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const run = Date.now().toString(36);
const owner = newUser("sync8", "owner", run);
const noa = newUser("sync8", "noa", run);
const maya = newUser("sync8", "maya", run);
const studioName = `e2e-sync8 סטודיו ${run}`;
const slug = `e2e-sync8-${run}`;
const className = "e2e-sync8 רפורמר";
const noaName = "e2e-sync8 נועה";
const mayaName = "e2e-sync8 מאיה";

const desktop: Screen = SCREENS.find((screen) => screen.name === "laptop-1280")!;
const phone: Screen = SCREENS.find((screen) => screen.name === "phone-360")!;

let poolId = "";
let ownerPage: Page;
let ownerPhone: BrowserContext | undefined;
let noaPage: Page;
let mayaPage: Page;
let organizationId = "";
let sessionId = "";
let noaPersonId = "";

const console_ = (path: string) => `${adminUrl}/o/${slug}${path}`;
const studio = <T = unknown>(page: Page, method: string, path: string, data?: unknown) =>
  ok<T>(page, method, `/organizations/${organizationId}${path}`, data);

/** axe, the fit (no sideways scroll; 44px targets on a phone) and the screenshot of one screen. */
async function checkScreen(page: Page, screen: Screen, app: string, label: string, selector?: string) {
  await settle(page);
  await expectNoSeriousA11yViolations(page, test.info(), `${label}, ${screen.name}`, selector);
  const fit = await measureFit(page, screen);
  expect.soft(fit.overflow, `${label} scrolls sideways at ${screen.name}`).toBeLessThanOrEqual(0);
  expect.soft(fit.smallTargets, `${label} has controls under 44px at ${screen.name}`).toEqual([]);
  await keepScreenshot(page, app, `sync8-${label.replace(/\W+/g, "-")}`, screen);
}

/** A member joins the studio through the invitation link the owner made for them. */
async function join(page: Page, link: string, user: typeof noa) {
  const memberLink = `${clientUrl}/invite#${link.split("#")[1]}`;
  await page.goto(memberLink);
  await page
    .getByRole("button", { name: /התחברות/ })
    .first()
    .click();
  await hostedUi(page, user, clientUrl);
  if (!page.url().includes("/invite")) await page.goto(memberLink);
  await page.getByRole("button", { name: "אישור ההצטרפות" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/invite"), { timeout: 30_000 });
}

test.beforeAll(async ({ browser }) => {
  poolId = userPoolId();
  test.skip(!poolId || !process.env.E2E_API_URL, "The dev user pool or API is not resolved: sign in to AWS first.");
  // The class starts in 15 minutes, in the studio's time: check-in opens 30 minutes before (docs/33 8.1).
  const start = studioParts(new Date(Date.now() + 15 * 60_000));
  test.skip(start.date !== studioParts(new Date()).date, "Too close to midnight for a class in 15 minutes.");
  for (const user of [owner, noa, maya]) createUser(poolId, user);
  ownerPage = await (await openScreen(browser, desktop)).newPage();
  noaPage = await (await openScreen(browser, phone)).newPage();
  mayaPage = await (await openScreen(browser, phone)).newPage();
});

test.afterAll(async () => {
  await ownerPhone?.close();
  for (const user of [owner, noa, maya]) {
    if (deleteUser(poolId, user)) console.log(`Deleted the Cognito user ${user.email}.`);
  }
  if (organizationId) console.log(`Left on dev for the operator's cleanup (A-4): studio ${slug} (${organizationId}).`);
});

test("1. the owner opens a studio with a room of six reformers and a class in 15 minutes; two members join", async () => {
  await signIn(ownerPage, adminUrl, owner);
  await expect(ownerPage.getByRole("heading", { name: "פתיחת סטודיו חדש" })).toBeVisible();
  await ownerPage.getByRole("textbox", { name: /שם הסטודיו/ }).fill(studioName);
  await ownerPage.getByRole("textbox", { name: /כתובת/ }).fill(slug);
  await ownerPage.getByRole("button", { name: "פתיחת הסטודיו" }).click();
  await ownerPage.waitForURL((url) => url.pathname.startsWith(`/o/${slug}`), { timeout: 30_000 });
  const me = await ok<{ memberships: { organization: { id: string; slug: string } }[] }>(ownerPage, "GET", "/me");
  organizationId = me.memberships.find((membership) => membership.organization.slug === slug)!.organization.id;

  // Two rows of three reformers, the instructor at the front.
  const room = await studio<{ id: string }>(ownerPage, "POST", "/rooms", {
    name: "e2e-sync8 חדר",
    defaultCapacity: 6,
  });
  await studio(ownerPage, "PUT", `/rooms/${room.id}/layout`, {
    spotSelection: true,
    rows: 2,
    cols: 3,
    mirrorFront: true,
    spots: [0, 1].flatMap((row) =>
      [0, 1, 2].map((col) => ({ label: String(row * 3 + col + 1), row, col, kind: "reformer", status: "active" })),
    ),
  });
  const type = await studio<{ id: string }>(ownerPage, "POST", "/class-types", {
    name: className,
    category: "pilates",
    color: "sage",
    defaultMinutes: 45,
  });
  const start = studioParts(new Date(Date.now() + 15 * 60_000));
  sessionId = (
    await studio<{ id: string }>(ownerPage, "POST", "/sessions", {
      classTypeId: type.id,
      roomId: room.id,
      localDate: start.date,
      localStart: start.time,
      minutes: 45,
      capacity: 6,
    })
  ).id;
  const card = await studio<{ id: string }>(ownerPage, "POST", "/pass-products", {
    name: "e2e-sync8 כרטיסייה",
    kind: "punch_card",
    entries: 5,
    validDays: 30,
    priceAgorot: 30000,
  });

  for (const [page, user, name] of [
    [noaPage, noa, noaName],
    [mayaPage, maya, mayaName],
  ] as const) {
    const person = await studio<{ id: string }>(ownerPage, "POST", "/people", { displayName: name, email: user.email });
    if (user === noa) noaPersonId = person.id;
    await studio(ownerPage, "POST", `/people/${person.id}/passes`, { productId: card.id, note: "e2e" });
    const invitation = await studio<{ link: string }>(ownerPage, "POST", `/people/${person.id}/invite`, {
      email: user.email,
    });
    await join(page, invitation.link, user);
  }
});

test("2. Maya makes a buddy code in her profile, Noa types it in hers, and they are buddies", async () => {
  await mayaPage.goto(`${clientUrl}/profile`);
  const mine = mayaPage.getByRole("region", { name: "חברות בסטודיו" });
  await mine.getByRole("button", { name: "יצירת קוד לחברה" }).click();
  await expect(mine.getByText("הקוד עובד פעם אחת, במשך 48 שעות.")).toBeVisible();
  const code = (await mine.locator(".tp-display").innerText()).replace(/\W/g, "");
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await checkScreen(mayaPage, phone, "client-web", "member profile, the buddy code");

  await noaPage.goto(`${clientUrl}/profile`);
  const hers = noaPage.getByRole("region", { name: "חברות בסטודיו" });
  await hers.getByRole("textbox", { name: "קיבלת קוד מחברה?" }).fill(code);
  await hers.getByRole("button", { name: "הוספה" }).click();
  await expect(noaPage.getByText(`את ו${mayaName} חברות עכשיו`)).toBeVisible();
  await expect(hers.getByText(mayaName)).toBeVisible();
  await checkScreen(noaPage, phone, "client-web", "member profile, a buddy");

  const buddies = await studio<{ items?: { displayName: string }[] } | { displayName: string }[]>(
    mayaPage,
    "GET",
    "/me/buddies",
  );
  const list = Array.isArray(buddies) ? buddies : (buddies.items ?? []);
  expect(list.map((buddy) => buddy.displayName)).toEqual([noaName]);
});

test("3. Maya books reformer 1; Noa sees her buddy on the map and books reformer 2, next to her", async () => {
  await studio(mayaPage, "POST", `/sessions/${sessionId}/bookings`, { spotId: await spotId(mayaPage, "1") });

  await noaPage.goto(`${clientUrl}/classes/${sessionId}`);
  await expect(noaPage.getByRole("heading", { name: "בחירת מכשיר" })).toBeVisible();
  const map = noaPage.getByRole("group", { name: "המכשירים בחדר" });
  await expect(map.getByRole("button", { name: `מכשיר 1, ${mayaName} כאן` })).toBeVisible();
  await map.getByRole("button", { name: /^מכשיר 2, פנוי/ }).click();
  await expect(map.getByRole("button", { name: /^מכשיר 2/ })).toHaveAttribute("aria-pressed", "true");
  await checkScreen(noaPage, phone, "client-web", "member class page, the room map with a buddy");

  await noaPage.getByRole("button", { name: "הרשמה לשיעור" }).click();
  await noaPage.getByRole("button", { name: "אישור ההרשמה, מכשיר 2" }).click();
  await expect(noaPage.getByRole("heading", { name: "המכשיר שלך" })).toBeVisible({ timeout: 30_000 });
  await expect(map.getByRole("button", { name: /^מכשיר 2, המקום שלך/ })).toBeVisible();
  await checkScreen(noaPage, phone, "client-web", "member class page, booked next to a buddy");
});

test("4. Noa shows her entry pass, staff check her in with the code, and the live map shows her arrival", async () => {
  await noaPage.goto(`${clientUrl}/`);
  await expect(noaPage.getByText("הצ׳ק־אין פתוח")).toBeVisible();
  await noaPage.getByRole("button", { name: "כניסה" }).click();
  const pass = noaPage.getByRole("dialog", { name: "כרטיס כניסה" });
  await expect(pass.getByRole("img", { name: "קוד לסריקה בכניסה לסטודיו" })).toBeVisible();
  await expect(pass).toContainText("מכשיר 2");
  await checkScreen(noaPage, phone, "client-web", "member entry pass", "[role='dialog']");

  // The code the QR carries, as the scanner reads it.
  const { code } = await studio<{ code: string }>(noaPage, "GET", "/me/checkin-code");
  expect(code).toMatch(/^TCI1\./);
  const checkin = await studio<{ person: { displayName: string }; spotLabel?: string; alreadyCheckedIn: boolean }>(
    ownerPage,
    "POST",
    "/checkins",
    { code, sessionId },
  );
  expect(checkin).toMatchObject({ person: { displayName: noaName }, spotLabel: "2", alreadyCheckedIn: false });

  for (const [page, screen] of await ownerScreens()) {
    await page.goto(console_(`/schedule/sessions/${sessionId}`));
    const room = page.getByRole("group", { name: "המכשירים בחדר" });
    await expect(room.getByRole("button", { name: new RegExp(`^מכשיר 2, ${noaName}, הגיע\\.ה`) })).toBeVisible();
    await expect(room.getByRole("button", { name: new RegExp(`^מכשיר 1, ${mayaName}`) })).toBeVisible();
    await expect(page.getByText("1 הגיעו מתוך 2")).toBeVisible();
    await checkScreen(page, screen, "admin-web", "console live class, an arrival");
  }
});

test("5. the owner's today page shows sales, occupancy and the check-in; the search finds Noa", async () => {
  for (const [page, screen] of await ownerScreens()) {
    await page.goto(console_("/today"));
    await expect(page.getByRole("heading", { level: 1, name: "היום בסטודיו" })).toBeVisible();
    await expect(page.getByRole("region", { name: "מכירות החודש" })).toContainText("600");
    await expect(page.getByRole("region", { name: "תפוסה השבוע" })).toBeVisible();
    const feed = page.getByRole("complementary", { name: "מה קורה בסטודיו" });
    await expect(feed.getByRole("listitem").filter({ hasText: "הגיע.ה ל" })).toContainText(noaName);
    await checkScreen(page, screen, "admin-web", "console today, insights");

    if (screen.touch) await page.getByRole("button", { name: "חיפוש" }).first().click();
    else await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "חיפוש בסטודיו" });
    await search.getByRole("combobox", { name: "חיפוש אנשים, שיעורים ומסכים" }).fill("נועה");
    const option = search.getByRole("option", { name: new RegExp(noaName) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await checkScreen(page, screen, "admin-web", "console search", "[role='dialog']");
    await option.click();
    await page.waitForURL((url) => url.pathname === `/o/${slug}/people/${noaPersonId}`);
  }
});

/** The owner's console at 1280, then the same sign-in on a 360px phone. */
async function ownerScreens(): Promise<[Page, Screen][]> {
  if (!ownerPhone) {
    const state = await ownerPage.context().storageState();
    ownerPhone = await ownerPage
      .context()
      .browser()!
      .newContext({
        viewport: { width: phone.width, height: phone.height },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        locale: "he-IL",
        timezoneId: "Asia/Jerusalem",
        storageState: state,
      });
  }
  const phonePage = ownerPhone.pages()[0] ?? (await ownerPhone.newPage());
  return [
    [ownerPage, desktop],
    [phonePage, phone],
  ];
}

/** The id of a spot in the class's room, by its label. */
async function spotId(page: Page, label: string): Promise<string> {
  const map = await studio<{ spots: { id: string; label: string }[] }>(page, "GET", `/sessions/${sessionId}/spots`);
  return map.spots.find((spot) => spot.label === label)!.id;
}
