// The member's invite run (board #445, O1, SL-8): a member books and shares her class with her name on, then off; a
// friend opens the link signed out, sees "<first name> מזמינה אותך" only while the name is on, signs up in the sheet
// and books; the source report then counts the friend under the member's link.
// usage: O4_STATE=... O4_SHOTS=... node o1-invite.mjs <width> <ua: std|ig>
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { API, authFor, call, confirmUser, newPassword, smokeToken } from "./o4-lib.mjs";

const [widthArg, uaArg] = process.argv.slice(2);
const width = Number(widthArg);
const ig = uaArg === "ig";
const st = JSON.parse(readFileSync(process.env.O4_STATE, "utf8"));
const shots = process.env.O4_SHOTS;
mkdirSync(shots, { recursive: true });
const IG =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.80";
const tag = `o1-${width}${ig ? "-ig" : ""}`;
const rid = Math.random().toString(36).slice(2, 8);
const notes = [];
const note = (ok, text) => {
  notes.push({ ok, text });
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
};

const browser = await chromium.launch();
const phone = width < 600;
const errors = [];
async function newPage() {
  const context = await browser.newContext({
    viewport: { width, height: phone ? 780 : 800 },
    isMobile: phone,
    hasTouch: phone,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    ...(ig ? { userAgent: IG } : {}),
  });
  // The phone's share sheet cannot be driven headless: keep what the app hands it.
  await context.addInitScript(() => {
    globalThis.__shared = [];
    globalThis.navigator.share = async (data) => {
      globalThis.__shared.push(data);
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/${tag}-${name}.png`, fullPage: false });
};
const overflow = async (page, label) => {
  const o = await page.evaluate(
    () => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
  );
  note(o <= 1, `${label}: no sideways scroll${o > 1 ? ` (${o}px)` : ""}`);
};
const visible = async (locator, label, timeout = 10000) => {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    note(true, label);
    return true;
  } catch {
    note(false, `${label} (not shown)`);
    return false;
  }
};

/** Signs up in the class page's sheet as `fullName`, confirms the address as admin (an example.com code is unreadable),
 *  adopts the session, and books the class. */
async function signUpAndBook(page, who, fullName, email, password) {
  await page.getByRole("button", { name: "שריינו לי מקום" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("שם מלא").fill(fullName);
  await dlg.getByLabel("אימייל").fill(email);
  await dlg.getByLabel("סיסמה").fill(password);
  await dlg.getByRole("button", { name: "שלחו קוד ושריינו" }).click();
  await dlg.getByRole("button", { name: "אישור ושריון" }).waitFor({ timeout: 20000 });
  confirmUser(email);
  const t = authFor(email, password);
  await page.evaluate((x) => localStorage.setItem("tempo.client-web.session", JSON.stringify(x)), {
    accessToken: t.AccessToken,
    refreshToken: t.RefreshToken,
    expiresAt: Date.now() + t.ExpiresIn * 1000,
  });
  // The sheet saves the typed name after the code (ReserveSheet's signedUp); the adopted session skips that, so do it here.
  await call(t.AccessToken, "POST", "/api/v1/session");
  await call(t.AccessToken, "PATCH", "/api/v1/me", { displayName: fullName });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "שריינו לי מקום" }).first().click();
  await page.waitForTimeout(2500);
  const join = page.getByRole("dialog").getByRole("button", { name: /הצטרפות לסטודיו/ });
  if (await join.count()) await join.click();
  if (await page.getByText("לא הצלחנו לצרף אותך").count()) {
    await page.evaluate(
      async ([api]) => {
        const tok = JSON.parse(localStorage.getItem("tempo.client-web.session")).accessToken;
        await fetch(`${api}/api/v1/session`, { method: "POST", headers: { Authorization: `Bearer ${tok}` } });
      },
      [API],
    );
    await join.click();
  }
  await page.waitForURL(/\/classes\//, { timeout: 20000 });
  await page.getByRole("button", { name: "אישור ההרשמה" }).click();
  return visible(page.getByRole("dialog").getByRole("heading", { name: /שמרנו לך מקום/ }), `${who}: booked`, 20000);
}

/** Taps "שליחה לחברה" and returns the URL the app handed the share sheet. */
async function shareUrl(page) {
  const before = await page.evaluate(() => globalThis.__shared.length);
  await page.getByRole("dialog").getByRole("button", { name: "שליחה לחברה" }).click();
  await page.waitForFunction((n) => globalThis.__shared.length > n, before, { timeout: 15000 });
  return page.evaluate(() => globalThis.__shared.at(-1).url);
}

try {
  // 1. The member books and shares, name on.
  const m = await newPage();
  const mEmail = `e2e-o4-o1m-${rid}@example.com`;
  await m.goto(st.urls.session, { waitUntil: "networkidle" });
  if (!(await signUpAndBook(m, "member", "מיכל בדיקה", mEmail, newPassword()))) throw new Error("member not booked");
  const dlg = m.getByRole("dialog");
  const toggle = dlg.getByLabel("להציג את השם שלי");
  note(await toggle.isChecked(), "share: 'להציג את השם שלי' is on by default");
  await m.waitForTimeout(2000); // the link is made when the dialog opens
  await shot(m, "member-share-name-on");
  await overflow(m, "booked dialog");
  const urlOn = await shareUrl(m);
  const code = new URL(urlOn).searchParams.get("src");
  note(Boolean(code), `share: the link carries src (${code ? "yes" : "no"})`);

  // 2. A friend opens it signed out: her first name only.
  const f = await newPage();
  await f.goto(urlOn, { waitUntil: "networkidle" });
  await visible(f.getByText("מיכל מזמינה אותך"), "friend: 'מיכל מזמינה אותך' with the name on");
  note((await f.getByText("מיכל בדיקה").count()) === 0, "friend: her first name only, no surname (SL-8)");
  await shot(f, "friend-invite-name-on");
  await overflow(f, "invite page");

  // 3. Name off: the same friend link shows no name.
  await toggle.uncheck({ force: true });
  await m.waitForTimeout(2500);
  const urlOff = await shareUrl(m);
  await shot(m, "member-share-name-off");
  // A fresh friend: the public link answer is cached for 60 s (max-age=60), so the first friend's browser would still
  // show the name for up to a minute.
  const f2 = await newPage();
  await f2.goto(urlOff, { waitUntil: "networkidle" });
  await f2.waitForTimeout(2500);
  note((await f2.getByText("מזמינה אותך").count()) === 0, "friend: no invite line with the name off");
  await shot(f2, "friend-invite-name-off");

  // 4. The friend signs up in the sheet and books.
  await signUpAndBook(f2, "friend", "שירה חברה", `e2e-o4-o1f-${rid}@example.com`, newPassword());
  await shot(f2, "friend-booked");
  await overflow(f2, "friend booked");

  // 5. The source report counts her under the member's link.
  const rep = (await call(smokeToken(), "GET", `/api/v1/organizations/${st.orgId}/reports/sources?days=7`)).json;
  const row = rep?.byLink?.find((l) => l.code === code);
  note(Boolean(row), `report: the member's link ${code} is listed`);
  if (row) note(row.members >= 1 && row.bookings >= 1, `report: members ${row.members}, bookings ${row.bookings}`);
} catch (e) {
  note(false, `threw: ${e.message.split("\n")[0]}`);
} finally {
  console.log("errors:", JSON.stringify(errors.slice(0, 5)));
  console.log(`${tag}: ${notes.filter((n) => n.ok).length}/${notes.length} passed`);
  await browser.close();
}
