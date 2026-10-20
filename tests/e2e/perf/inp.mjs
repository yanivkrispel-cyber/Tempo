// Tap responsiveness: the Event Timing API's longest event per interaction (what INP reports), CPU slowed 4x.
import { chromium, devices } from "@playwright/test";
const CLIENT = "https://tempo-members.pages.dev", ADMIN = "https://tempo-studio-console.pages.dev", SLUG = "tempo-smoke-studio";
const b = await chromium.launch();
const c = await b.newContext({ ...devices["Pixel 7"], storageState: ".auth/smoke-user.json", locale: "he-IL" });
await c.addInitScript(() => { window.__ev = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ id: e.interactionId, name: e.name, d: e.duration }); }).observe({ type: "event", durationThreshold: 16, buffered: true }); });
let p = await c.newPage();
const cdp = await c.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
async function tap(label, locator) {
  await p.evaluate(() => (window.__ev = []));
  const t = Date.now();
  await locator.click({ timeout: 10000 }).catch((e) => console.log("  miss", label, e.message.split("\n")[0]));
  await p.waitForTimeout(1500);
  const ev = await p.evaluate(() => window.__ev);
  const worst = ev.reduce((m, e) => Math.max(m, e.d), 0);
  console.log(`${label.padEnd(34)} worst event ${String(Math.round(worst)).padStart(5)} ms  (${ev.length} entries)`);
  return worst;
}
async function settle(url) { await p.goto(url); await p.waitForTimeout(7000); }
await settle(`${CLIENT}/`);
const tabs = p.locator("nav a");
console.log("member tabs:", await tabs.allInnerTexts());
for (let i = 0; i < Math.min(await tabs.count(), 5); i++) await tap(`member tab ${i} ${(await tabs.nth(i).innerText()).trim()}`, tabs.nth(i));
await settle(`${CLIENT}/book`);
const cls = p.locator('a[href*="/classes/"]');
if (await cls.count()) await tap("member open class from /book", cls.first());
await p.close();
const dc = await b.newContext({ ...devices["Desktop Chrome"], storageState: ".auth/smoke-user.json", locale: "he-IL" });
await dc.addInitScript(() => { window.__ev = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ id: e.interactionId, name: e.name, d: e.duration }); }).observe({ type: "event", durationThreshold: 16, buffered: true }); });
p = await dc.newPage(); await (await dc.newCDPSession(p)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
await settle(`${ADMIN}/o/${SLUG}/schedule`);
const nav = p.locator("nav a:visible");
for (let i = 0; i < Math.min(await nav.count(), 5); i++) await tap(`console nav ${i} ${(await nav.nth(i).innerText()).trim().split("\n")[0]}`, nav.nth(i));
await settle(`${ADMIN}/o/${SLUG}/people`);
const search = p.getByRole("searchbox").or(p.locator("input[type=search]")).first();
if (await search.count()) { await p.evaluate(() => (window.__ev = [])); await search.pressSequentially("דנה", { delay: 120 }); await p.waitForTimeout(1500); const ev = await p.evaluate(() => window.__ev); console.log(`console people search typing           worst event ${Math.round(ev.reduce((m, e) => Math.max(m, e.d), 0))} ms`); }
await b.close();
