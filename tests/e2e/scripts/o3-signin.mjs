// The branded sign-in run (board #445, O3a, docs/36): on the studio's own /s/<slug>/login, a fictional member signs
// in with a password and lands on the class returnTo named; a newcomer signs up, reaches the six-digit step and is
// told a wrong code is wrong; a returnTo that leaves the app lands on the studio's home (S-D). No password, code or
// token is logged to the console or kept outside the session key authClient writes.
// usage: O4_STATE=... O4_SHOTS=... [O3_APP=http://localhost:5174] [O3_BRAND=1] node o3-signin.mjs <width>
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { APP, confirmUser, createUser, deleteUser, newPassword } from "./o4-lib.mjs";

const width = Number(process.argv[2]);
const st = JSON.parse(readFileSync(process.env.O4_STATE, "utf8"));
const shots = process.env.O4_SHOTS;
mkdirSync(shots, { recursive: true });
const tag = `o3-${width}`;
const rid = Math.random().toString(36).slice(2, 8);
const app = process.env.O3_APP ?? APP;
const base = `${app}/s/${st.slug}`;
const classPath = new URL(st.urls.session).pathname.replace(`/s/${st.slug}`, "");
const notes = [];
const note = (ok, text) => {
  notes.push({ ok, text });
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
};

const browser = await chromium.launch();
const phone = width < 600;
const errors = [];
const logged = [];
async function newPage() {
  const context = await browser.newContext({ viewport: { width, height: phone ? 780 : 800 }, locale: "he-IL" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => logged.push(message.text()));
  return page;
}
const noSideScroll = async (page, where) =>
  note(
    (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0,
    `${where}: no sideways scroll`,
  );
/** Everything the page keeps in local and session storage, apart from the session key authClient writes. */
const stored = (page) =>
  page.evaluate(() =>
    [localStorage, sessionStorage]
      .flatMap((store) => Object.keys(store).map((key) => [key, store.getItem(key)]))
      .filter(([key]) => key !== "tempo.client-web.session")
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );

/** After the password, the screen may offer a passkey for next time ("בפעם הבאה, בלי סיסמה"); the run declines it. */
async function passOffer(page, where) {
  const later = page.getByRole("button", { name: "לא עכשיו" });
  if (
    await later.waitFor({ timeout: 8_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await page.screenshot({ path: `${shots}/${tag}-${where}-passkey-offer.png` });
    await later.click();
  }
}

const created = [];
const secrets = [];
try {
  // 1. A member signs in with a password and lands on the class returnTo named.
  const email = `e2e-o4-o3m-${rid}@example.com`;
  const password = newPassword();
  createUser(email, password);
  created.push(email);
  secrets.push(password);
  const p1 = await newPage();
  await p1.goto(`${base}/login?returnTo=${encodeURIComponent(classPath)}`, { waitUntil: "networkidle" });
  // The studio's brand on the sign-in comes with WL5 part B; before it deploys the screen wears Tempo's.
  const branded = await p1
    .getByText("סטודיו בדיקה", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
  if (process.env.O3_BRAND === "1") note(branded, "sign-in wears the studio's name (WL5)");
  else console.log(`INFO the sign-in wears ${branded ? "the studio's" : "Tempo's"} name`);
  await p1.screenshot({ path: `${shots}/${tag}-email.png` });
  await noSideScroll(p1, "email step");
  await p1.getByLabel("אימייל").fill(email);
  await p1.getByRole("button", { name: "המשך" }).click();
  await p1.getByLabel("סיסמה", { exact: true }).fill(password);
  await p1.screenshot({ path: `${shots}/${tag}-password.png` });
  await p1.getByRole("button", { name: "כניסה", exact: true }).click();
  await passOffer(p1, "member");
  const target = `/s/${st.slug}${classPath}`;
  await p1.waitForURL((url) => url.pathname === target, { timeout: 20_000 }).catch(() => undefined);
  await p1.screenshot({ path: `${shots}/${tag}-after-signin.png` });
  note(
    new URL(p1.url()).pathname === target,
    `password sign-in lands on the class returnTo named (${new URL(p1.url()).pathname})`,
  );
  const session = await p1.evaluate(() => JSON.parse(localStorage.getItem("tempo.client-web.session") ?? "null"));
  note(Boolean(session?.accessToken && session?.refreshToken), "the session is in authClient's key");
  if (session) secrets.push(session.accessToken, session.refreshToken);
  const elsewhere = await stored(p1);
  note(!secrets.some((secret) => elsewhere.includes(secret)), "no password or token stored outside the session key");
  // The class page, once it has read the class rather than while its skeleton shows.
  await p1
    .getByRole("heading", { level: 1 })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  await p1.waitForLoadState("networkidle");
  await p1.screenshot({ path: `${shots}/${tag}-landed.png` });

  // 2. A newcomer signs up and reaches the six-digit step; a wrong code is said to be wrong.
  const fresh = `e2e-o4-o3n-${rid}@example.com`;
  const freshPassword = newPassword();
  secrets.push(freshPassword);
  const p2 = await newPage();
  await p2.goto(`${base}/login?screen=signup&returnTo=${encodeURIComponent(classPath)}`, { waitUntil: "networkidle" });
  await p2.getByLabel("אימייל").fill(fresh);
  await p2.getByLabel("סיסמה", { exact: true }).fill(freshPassword);
  await p2.screenshot({ path: `${shots}/${tag}-signup.png` });
  await p2.getByRole("button", { name: "יצירת חשבון" }).click();
  created.push(fresh);
  await p2.getByRole("heading", { name: "אימות האימייל" }).waitFor({ timeout: 20_000 });
  note(true, "sign-up reaches the six-digit step");
  await p2.getByLabel("קוד בן שש ספרות").fill("000000");
  await p2.screenshot({ path: `${shots}/${tag}-code.png` });
  await noSideScroll(p2, "code step");
  await p2.getByRole("button", { name: "אישור", exact: true }).click();
  note(
    await p2
      .getByText("הקוד לא נכון. בדקו ונסו שוב.")
      .waitFor({ timeout: 15_000 })
      .then(
        () => true,
        () => false,
      ),
    "a wrong code is said to be wrong",
  );
  await p2.screenshot({ path: `${shots}/${tag}-code-wrong.png` });

  // 3. The newcomer, confirmed out of band, signs in; a returnTo that leaves the app lands on the studio's home.
  confirmUser(fresh);
  const p3 = await newPage();
  await p3.goto(`${base}/login?returnTo=${encodeURIComponent("https://evil.example/")}`, { waitUntil: "networkidle" });
  await p3.getByLabel("אימייל").fill(fresh);
  await p3.getByRole("button", { name: "המשך" }).click();
  await p3.getByLabel("סיסמה", { exact: true }).fill(freshPassword);
  await p3.getByRole("button", { name: "כניסה", exact: true }).click();
  await passOffer(p3, "newcomer");
  await p3
    .waitForURL((url) => url.origin === app && !url.pathname.endsWith("/login"), { timeout: 20_000 })
    .catch(() => undefined);
  const landed = new URL(p3.url());
  note(
    landed.origin === app && landed.pathname.startsWith(`/s/${st.slug}`) && !landed.pathname.endsWith("/login"),
    `a foreign returnTo stays in the studio's app (${landed.pathname})`,
  );
} catch (error) {
  note(false, `run stopped: ${error.message.split("\n")[0]}`);
} finally {
  for (const email of created) deleteUser(email);
  await browser.close();
}
note(
  !logged.some((line) => secrets.some((secret) => secret && line.includes(secret))),
  "the console shows no password, code or token",
);
note(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ""}`);
const failed = notes.filter((n) => !n.ok);
console.log(`${tag}: ${notes.length - failed.length}/${notes.length}`);
process.exit(failed.length ? 1 : 0);
