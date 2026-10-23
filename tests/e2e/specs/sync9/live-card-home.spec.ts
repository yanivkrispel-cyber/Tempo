import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createUser, deleteUser, hostedUi, newUser, ok, signIn, userPoolId } from "../../support/accounts";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl } from "../../support/env";
import { keepScreenshot, measureFit, openScreen, SCREENS, settle, type Screen } from "../../support/screens";
import { studioParts } from "../../support/studio";

/**
 * SYNC 9 (day board #481, O1): the screens boards #445 and #471 added, against the dev API and the dev sites, with
 * three fresh users and no smoke user: the owner at a computer (1280px) and on a phone (360px), two members at 360px.
 * 1. The owner opens a studio with a room of three reformers and a one-place class in 15 minutes; waiting is open up
 *    to the start for now. Both members join through their invitations.
 * 2. Maya books reformer 1; the booked sheet's "שיתוף לסטורי" draws the "I'm in" card (C-1) and saves it.
 * 3. Noa waits. The owner closes the waitlist an hour before the class, so Maya's late cancel moves nobody.
 * 4. OwnerLive (LV-1): the clock against the class length, Noa waiting with "שיבוץ למכשיר 1", the seat, map or list,
 *    and her arrival with the door code.
 * 5. Noa's home: the week with the class under the chosen day, and the months under the weeks' dots (#480).
 * 6. The owner's today: the occupancy legend and the month's sales in whole shekels (LV-2).
 * axe runs on every screen, and each is kept as a screenshot with E2E_SCREENSHOTS=1.
 *
 * Cleanup: the three Cognito users are deleted here; the studio waits for the operator's cleanup (A-4). Every name is
 * `e2e-`, every email `e2e-…@example.com`.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const run = Date.now().toString(36);
const owner = newUser("sync9", "owner", run);
const noa = newUser("sync9", "noa", run);
const maya = newUser("sync9", "maya", run);
const studioName = `e2e-sync9 סטודיו ${run}`;
const slug = `e2e-sync9-${run}`;
const className = "e2e-sync9 רפורמר";
const noaName = "e2e-sync9 נועה";
const mayaName = "e2e-sync9 מאיה";

const desktop: Screen = SCREENS.find((screen) => screen.name === "laptop-1280")!;
const phone: Screen = SCREENS.find((screen) => screen.name === "phone-360")!;

let poolId = "";
let ownerPage: Page;
let ownerPhone: BrowserContext | undefined;
let noaPage: Page;
let mayaPage: Page;
let organizationId = "";
let sessionId = "";

const console_ = (path: string) => `${adminUrl}/o/${slug}${path}`;
const studio = <T = unknown>(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
) => ok<T>(page, method, `/organizations/${organizationId}${path}`, data, headers);

/** axe, the fit (no sideways scroll; 44px targets on a phone) and the screenshot of one screen. */
async function checkScreen(page: Page, screen: Screen, app: string, label: string, selector?: string) {
  await settle(page);
  await expectNoSeriousA11yViolations(page, test.info(), `${label}, ${screen.name}`, selector);
  const fit = await measureFit(page, screen);
  expect.soft(fit.overflow, `${label} scrolls sideways at ${screen.name}`).toBeLessThanOrEqual(0);
  expect.soft(fit.smallTargets, `${label} has controls under 44px at ${screen.name}`).toEqual([]);
  await keepScreenshot(page, app, `sync9-${label.replace(/\W+/g, "-")}`, screen);
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

/** Waiting closes `hours` before a class; the rest of the studio's booking policy stays as it is. */
async function waitlistCutoff(hours: number) {
  const policy = await studio<{
    freeCancelHours: number;
    bookingHorizonDays: number;
    waitlistEnabled: boolean;
    version: string;
  }>(ownerPage, "GET", "/booking-policy");
  await studio(
    ownerPage,
    "PUT",
    "/booking-policy",
    {
      freeCancelHours: policy.freeCancelHours,
      waitlistCutoffHours: hours,
      bookingHorizonDays: policy.bookingHorizonDays,
      waitlistEnabled: true,
    },
    { "If-Match": policy.version },
  );
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
  const mayaContext = await openScreen(browser, phone);
  // No share sheet that takes files, as on a computer: the card is saved, and the test can catch the file.
  await mayaContext.addInitScript(() => Object.defineProperty(navigator, "canShare", { value: undefined }));
  mayaPage = await mayaContext.newPage();
});

test.afterAll(async () => {
  await ownerPhone?.close();
  for (const user of [owner, noa, maya]) {
    if (deleteUser(poolId, user)) console.log(`Deleted the Cognito user ${user.email}.`);
  }
  if (organizationId) console.log(`Left on dev for the operator's cleanup (A-4): studio ${slug} (${organizationId}).`);
});

test("1. the owner opens a studio with three reformers and a one-place class in 15 minutes; two members join", async () => {
  await signIn(ownerPage, adminUrl, owner);
  await expect(ownerPage.getByRole("heading", { name: "פתיחת סטודיו חדש" })).toBeVisible();
  await ownerPage.getByRole("textbox", { name: /שם הסטודיו/ }).fill(studioName);
  await ownerPage.getByRole("textbox", { name: /כתובת/ }).fill(slug);
  await ownerPage.getByRole("button", { name: "פתיחת הסטודיו" }).click();
  await ownerPage.waitForURL((url) => url.pathname.startsWith(`/o/${slug}`), { timeout: 30_000 });
  const me = await ok<{ memberships: { organization: { id: string; slug: string } }[] }>(ownerPage, "GET", "/me");
  organizationId = me.memberships.find((membership) => membership.organization.slug === slug)!.organization.id;

  const room = await studio<{ id: string }>(ownerPage, "POST", "/rooms", {
    name: "e2e-sync9 חדר",
    defaultCapacity: 3,
  });
  await studio(ownerPage, "PUT", `/rooms/${room.id}/layout`, {
    spotSelection: true,
    rows: 1,
    cols: 3,
    mirrorFront: true,
    spots: [0, 1, 2].map((col) => ({ label: String(col + 1), row: 0, col, kind: "reformer", status: "active" })),
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
      capacity: 1,
    })
  ).id;
  // Waiting stays open up to the start, so Noa can wait for a class that is 15 minutes away.
  await waitlistCutoff(0);
  const card = await studio<{ id: string }>(ownerPage, "POST", "/pass-products", {
    name: "e2e-sync9 כרטיסייה",
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
    await studio(ownerPage, "POST", `/people/${person.id}/passes`, { productId: card.id, note: "e2e" });
    const invitation = await studio<{ link: string }>(ownerPage, "POST", `/people/${person.id}/invite`, {
      email: user.email,
    });
    await join(page, invitation.link, user);
  }
});

test("2. Maya books reformer 1, and the booked sheet saves her 'I'm in' card (C-1)", async () => {
  await mayaPage.goto(`${clientUrl}/classes/${sessionId}`);
  const map = mayaPage.getByRole("group", { name: "המכשירים בחדר" });
  await map.getByRole("button", { name: /^מכשיר 1, פנוי/ }).click();
  await mayaPage.getByRole("button", { name: "הרשמה לשיעור" }).click();
  await mayaPage.getByRole("button", { name: "אישור ההרשמה, מכשיר 1" }).click();

  const sheet = mayaPage.getByRole("dialog", { name: /^שמרנו לך מקום/ });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const share = sheet.getByRole("button", { name: "שיתוף לסטורי" });
  // The picture is drawn ahead, once the public class and the brand have answered.
  await expect(share).toBeEnabled({ timeout: 15_000 });
  await checkScreen(mayaPage, phone, "client-web", "member booked sheet, the I'm in card", "[role='dialog']");
  const [download] = await Promise.all([mayaPage.waitForEvent("download"), share.click()]);
  expect(download.suggestedFilename()).toBe("tempo-class.png");
  await expect(sheet.getByRole("button", { name: "התמונה נשמרה" })).toBeVisible();
});

test("3. Noa waits; the owner closes waiting an hour before, so Maya's late cancel moves nobody", async () => {
  const waiting = await studio<{ status: string }>(noaPage, "POST", `/sessions/${sessionId}/bookings`, {});
  expect(waiting.status).toBe("waitlisted");

  await waitlistCutoff(1);
  const mine = await studio<{ items: { id: string; session: { id: string } }[] }>(mayaPage, "GET", "/me/bookings");
  const booking = mine.items.find((item) => item.session.id === sessionId)!;
  await studio(mayaPage, "POST", `/bookings/${booking.id}/cancel`, {});
});

test("4. OwnerLive: the clock, Noa waiting, 'שיבוץ למכשיר 1', map or list, and her arrival", async () => {
  const screens = await ownerScreens();
  const [page, screen] = screens[0]!;
  await page.goto(console_(`/live/${sessionId}`));
  await expect(page.getByRole("heading", { level: 1, name: className })).toBeVisible();
  await expect(page.getByRole("timer", { name: "זמן מתחילת השיעור" })).toBeVisible();
  await expect(page.getByText("מתוך 45 דקות")).toBeVisible();
  await expect(page.getByText(/^מתחיל בעוד \d+ דק׳$/)).toBeVisible();
  const waiting = page.getByRole("region", { name: "רשימת המתנה" });
  await expect(waiting).toContainText(`${noaName} ממתין.ה`);
  await expect(waiting).toContainText("מכשיר 1 פנוי");
  await checkScreen(page, screen, "admin-web", "console live, a person waiting");

  await waiting.getByRole("button", { name: "שיבוץ למכשיר 1" }).click();
  await expect(page.getByText(`${noaName} שובצ.ה למכשיר 1`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "רשימת המתנה" })).toHaveCount(0);
  const room = page.getByRole("group", { name: "המכשירים בחדר" });
  await expect(room.getByRole("button", { name: new RegExp(`^מכשיר 1, ${noaName}`) })).toBeVisible();

  // Her code, as the door scanner reads it (Playwright has no camera).
  const { code } = await studio<{ code: string }>(noaPage, "GET", "/me/checkin-code");
  await studio(ownerPage, "POST", "/checkins", { code, sessionId });

  for (const [livePage, liveScreen] of screens) {
    await livePage.goto(console_(`/live/${sessionId}`));
    // OwnerLive's count: the arrivals large, then "מתוך N הגיעו".
    const count = livePage.getByRole("region", { name: "מתוך 1 הגיעו" });
    await expect(count.locator("strong")).toHaveText("1");
    await expect(
      livePage
        .getByRole("group", { name: "המכשירים בחדר" })
        .getByRole("button", { name: new RegExp(`^מכשיר 1, ${noaName}, הגיע\\.ה`) }),
    ).toBeVisible();
    await checkScreen(livePage, liveScreen, "admin-web", "console live, the map");
    // A computer shows the map and the list side by side; a phone switches between them.
    if (liveScreen.touch) {
      await livePage.getByRole("group", { name: "תצוגה" }).getByRole("button", { name: "רשימה" }).click();
      await checkScreen(livePage, liveScreen, "admin-web", "console live, the list");
    }
    await expect(livePage.getByRole("region", { name: "רשימת המשתתפים" })).toContainText(noaName);
  }
});

test("5. Noa's home: the week with today's class under it, and the months under the weeks' dots", async () => {
  await noaPage.goto(`${clientUrl}/`);
  const week = noaPage.getByRole("region", { name: "השבוע שלך" });
  await expect(week.getByRole("link", { name: "לכל המערכת" })).toHaveAttribute("href", "/book");
  await expect(week.getByRole("region", { name: "השיעורים של היום" })).toContainText(className);
  await expect(noaPage.getByTestId("pace-months")).toBeAttached();
  await checkScreen(noaPage, phone, "client-web", "member home, the week and the pace");
});

test("6. the owner's today: the occupancy legend and the month's sales in whole shekels", async () => {
  for (const [page, screen] of await ownerScreens()) {
    await page.goto(console_("/today"));
    const sales = page.getByRole("region", { name: "מכירות החודש" });
    await expect(sales).toContainText("600");
    await expect(sales).not.toContainText("600.00");
    const occupancy = page.getByRole("region", { name: "תפוסה השבוע" });
    await expect(occupancy.getByText("מלא עם המתנה")).toBeVisible();
    await expect(occupancy.getByText("יש מקום")).toBeVisible();
    await checkScreen(page, screen, "admin-web", "console today, the legend");
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
