// The phone run (board #404, O4): drives the deployed member app on dev for each link target, per width and user agent.
// usage: O4_STATE=... node o4-run.mjs <run> <width> <ua: std|ig> ; writes screenshots to O4_SHOTS.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { APP, API, authFor, confirmUser, deleteUser, newPassword, call } from "./o4-lib.mjs";

const [run, widthArg, uaArg] = process.argv.slice(2);
const width = Number(widthArg);
const ig = uaArg === "ig";
const st = JSON.parse(readFileSync(process.env.O4_STATE, "utf8"));
const shots = process.env.O4_SHOTS;
mkdirSync(shots, { recursive: true });
const IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.80";
const label = { L: "class-signup-local", 1: "class", 2: "offer", 3: "prices", 4: "full-class" }[run];
const tag = `o4-${width}${ig ? "-ig" : ""}-${label}`;
const rid = Math.random().toString(36).slice(2, 8);
const email = `e2e-o4-${rid}@example.com`;
const password = newPassword();
const notes = [];
const note = (ok, text) => { notes.push({ ok, text }); console.log(`${ok ? "PASS" : "FAIL"} ${text}`); };

const browser = await chromium.launch();
const phone = width < 600;
const context = await browser.newContext({
  viewport: { width, height: phone ? 780 : 800 },
  isMobile: phone, hasTouch: phone, locale: "he-IL", timezoneId: "Asia/Jerusalem",
  ...(ig ? { userAgent: IG } : {}),
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
page.on("response", async (r) => { if (r.status() >= 400 && r.url().startsWith("https://2a5q")) { const b = await r.text().catch(() => ""); console.log("API", r.status(), r.request().method(), new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, "{id}"), b.slice(0, 160)); } });
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/${tag}-${name}.png`, fullPage: false }); };
const overflow = async (label) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (o > 1) note(false, `${label}: page scrolls sideways by ${o}px`);
};
const withUrl = (url) => url;
let created = false;

/** Dev has the in-sheet sign-up (branded_login, #440): fill it and reach the emailed-code step. The code cannot be read
 *  for an example.com address, so the user is confirmed as admin and the session adopted; then the page reloads and
 *  the sheet opens again, signed in. */
async function brandedSignIn(openSheet) {
  await openSheet();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("שם מלא").fill("נועה בדיקה");
  await dlg.getByLabel("אימייל").fill(email);
  await dlg.getByLabel("סיסמה").fill(password);
  await shot("sheet-filled");
  await dlg.getByRole("button", { name: "שלחו קוד ושריינו" }).click();
  await dlg.getByRole("button", { name: "אישור ושריון" }).waitFor({ timeout: 20000 });
  created = true; await shot("code-step"); await overflow("code step");
  confirmUser(email);
  const t = authFor(email, password);
  await page.evaluate((x) => localStorage.setItem("tempo.client-web.session", JSON.stringify(x)), { accessToken: t.AccessToken, refreshToken: t.RefreshToken, expiresAt: Date.now() + t.ExpiresIn * 1000 });
  await page.reload({ waitUntil: "networkidle" });
  await openSheet();
}

try {
  const visible = async (locator, label, timeout = 8000) => {
    try { await locator.first().waitFor({ state: "visible", timeout }); note(true, label); return true; }
    catch { note(false, `${label} (not shown)`); return false; }
  };
  const absent = async (locator, label) => note((await locator.count()) === 0, label);
  const igChecks = async () => {
    const dlg = page.getByRole("dialog");
    if (ig) {
      await visible(dlg.getByText("פתיחה בדפדפן").first(), "Instagram: the 'פתיחה בדפדפן' card is shown");
      await absent(page.getByText("הוספה למסך הבית"), "Instagram: no install offer");
      await absent(page.getByText(/Face ID/), "Instagram: no Face ID offer");
    } else {
      await absent(dlg.getByText("פתיחה בדפדפן"), "real browser: no 'פתיחה בדפדפן' card");
    }
  };
  const bookedChecks = async () => {
    const dlg = page.getByRole("dialog");
    if (!(await visible(dlg.getByRole("heading", { name: /שמרנו לך מקום/ }), "booked: 'שמרנו לך מקום' dialog"))) return;
    await shot("booked");
    await overflow("booked dialog");
    const dl = page.waitForEvent("download", { timeout: 15000 });
    await dlg.getByRole("button", { name: "הוספה ליומן" }).click();
    try { const d = await dl; note(/\.ics$/.test(d.suggestedFilename()), `booked: .ics downloaded (${d.suggestedFilename()})`); }
    catch { note(false, "booked: .ics did not download"); }
    await visible(dlg.getByRole("button", { name: "שליחה לחברה" }), "booked: 'שליחה לחברה' present");
    await dlg.getByRole("button", { name: "שליחה לחברה" }).click().catch(() => {});
    await igChecks();
    await shot("booked-after-actions");
  };
  const signInAndJoin = async (openSheet) => {
    await brandedSignIn(openSheet);
    await page.waitForTimeout(2500); // the account is provisioned by POST /session just after the return
    await shot("back-from-login");
    const join = page.getByRole("dialog").getByRole("button", { name: /הצטרפות לסטודיו|לקחת את המבצע ולשריין/ });
    if (await join.count()) await join.click();
    await page.waitForTimeout(2500);
    if (await page.getByText("לא הצלחנו לצרף אותך").count()) {
      note(false, "BUG: first join after sign-in fails with account.not_provisioned (the page never calls POST /session)");
      await shot("join-error");
      // Work around it to carry on: provision the account as the app's other pages do, then press again.
      await page.evaluate(async ([api]) => {
        const t = JSON.parse(localStorage.getItem("tempo.client-web.session")).accessToken;
        await fetch(`${api}/api/v1/session`, { method: "POST", headers: { Authorization: `Bearer ${t}` } });
      }, [API]);
      await join.click();
    }
  };

  if (run === "L") {
    // The in-sheet sign-up (branded_login) is off in the deployed dev bundle, so this one runs on a local Vite against dev.
    const local = st.urls.session.replace(APP, "http://localhost:5174");
    await page.goto(local, { waitUntil: "networkidle" });
    await shot("landing");
    await page.getByRole("button", { name: "שריינו לי מקום" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("שם מלא").fill("נועה בדיקה");
    await dlg.getByLabel("אימייל").fill(email);
    await dlg.getByLabel("סיסמה").fill(password);
    await shot("sheet-filled");
    await dlg.getByRole("button", { name: "שלחו קוד ושריינו" }).click();
    await visible(dlg.getByRole("button", { name: "אישור ושריון" }), "sheet: moved to the emailed-code step", 20000);
    created = true; await shot("code-step"); await overflow("code step");
    confirmUser(email); // the emailed code is unreadable for an example.com address: confirm as admin, adopt the session
    const t = authFor(email, password);
    await page.evaluate((x) => localStorage.setItem("tempo.client-web.session", JSON.stringify(x)), { accessToken: t.AccessToken, refreshToken: t.RefreshToken, expiresAt: Date.now() + t.ExpiresIn * 1000 });
    await page.goto(`${local.split("?")[0]}?reserve=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.getByRole("dialog").getByRole("button", { name: /הצטרפות לסטודיו/ }).click();
    await page.waitForURL(/\/classes\//, { timeout: 20000 });
    await page.getByRole("button", { name: "אישור ההרשמה" }).click();
    await bookedChecks();
  } else if (run === "1") {
    await page.goto(st.urls.session, { waitUntil: "networkidle" });
    await shot("landing"); await overflow("class landing");
    await signInAndJoin(async () => { await page.getByRole("button", { name: "שריינו לי מקום" }).first().click(); });
    await page.waitForURL(/\/classes\//, { timeout: 20000 });
    await page.getByRole("button", { name: "אישור ההרשמה" }).click();
    await bookedChecks();
  } else if (run === "2") {
    await page.goto(st.urls.offer, { waitUntil: "networkidle" });
    await shot("landing"); await overflow("offer landing");
    const radios = page.getByRole("radio");
    note((await radios.count()) >= 1, `offer page lists ${await radios.count()} first-class choices`);
    if ((await radios.count()) > 1) await radios.nth(1).check();
    await shot("picked");
    await signInAndJoin(async () => {
      const choices = page.getByRole("radio");
      if ((await choices.count()) > 1) await choices.nth(1).check();
      await page.getByRole("button", { name: "לקחת את המבצע ולשריין" }).first().click();
    });
    const done = await visible(page.getByText(/המבצע שמור והשיעור שוריין|המבצע שמור, והמקום שלכם|המבצע שמור. הסטודיו מבקש/), "offer: joined and booked (or declaration asked)", 20000);
    await shot("joined"); await overflow("offer joined");
    if (done) await igChecks();
    if (done) {
      await page.getByRole("link", { name: "לפרטי השיעור" }).click().catch(() => {});
      await page.waitForTimeout(2500); await shot("class-screen"); await overflow("class screen after offer");
    }
  } else if (run === "3") {
    await page.goto(st.urls.prices, { waitUntil: "networkidle" });
    await visible(page.getByRole("heading", { name: "מחירים" }), "prices: heading");
    await visible(page.getByText(/e2e-o4 3 שיעורי ניסיון/), "prices: the listed offer");
    await shot("page"); await overflow("prices");
  } else if (run === "4") {
    await page.goto(st.urls.fullSession, { waitUntil: "networkidle" });
    await shot("alternatives");
    const alts = page.getByRole("region", { name: "שיעורים עם מקום" }).getByRole("link");
    await alts.first().waitFor({ timeout: 10000 }).catch(() => {});
    note((await alts.count()) >= 1, `full class: ${await alts.count()} alternatives shown`);
    await overflow("full class");
  }
} catch (e) {
  note(false, `run ${run} threw: ${e.message.split("\n")[0]}`);
  await shot("error").catch(() => {});
} finally {
  if (!notes.length) console.log("(no checks)");
  console.log("errors:", JSON.stringify(errors.slice(0, 5)));
  await browser.close();
}
