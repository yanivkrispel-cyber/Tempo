// Screen performance baseline: each key screen of both apps on a mid-range phone profile
// (Pixel 7 viewport, Lighthouse "Slow 4G" network, CPU slowed 4x), first visit and repeat visit.
// Usage: node perf/screens-perf.mjs [outFile]   (needs .auth/smoke-user.json from the sign-in project)
import { chromium, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";

const CLIENT = process.env.E2E_CLIENT_URL ?? "https://tempo-members.pages.dev";
const ADMIN = process.env.E2E_ADMIN_URL ?? "https://tempo-studio-console.pages.dev";
const SLUG = process.env.E2E_STUDIO_SLUG ?? "tempo-smoke-studio";
const STATE = ".auth/smoke-user.json";
const RUNS = Number(process.env.PERF_RUNS ?? 3);

const screens = [
  ["member", "home", `${CLIENT}/`],
  ["member", "book", `${CLIENT}/book`],
  ["member", "bookings", `${CLIENT}/bookings`],
  ["member", "profile", `${CLIENT}/profile`],
  ["member", "inbox", `${CLIENT}/inbox`],
  ["console", "today", `${ADMIN}/o/${SLUG}/today`],
  ["console", "schedule", `${ADMIN}/o/${SLUG}/schedule`],
  ["console", "people", `${ADMIN}/o/${SLUG}/people`],
  ["console", "passes", `${ADMIN}/o/${SLUG}/passes`],
  ["console", "reports", `${ADMIN}/o/${SLUG}/reports`],
];

// Lighthouse mobile defaults (Slow 4G, applied at the protocol level).
const NETWORK = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_RATE = 4;

const vitalsScript = () => {
  window.__perf = { lcp: 0, cls: 0, fcp: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__perf.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
};

async function measure(page, url) {
  const api = [];
  let jsBytes = 0;
  const t0 = Date.now();
  const onFinished = async (req) => {
    const res = await req.response().catch(() => null);
    const timing = req.timing();
    if (req.url().includes("/api/v1/")) {
      api.push({ path: new URL(req.url()).pathname.replace(/[0-9a-f-]{36}/g, ":id"), start: timing.startTime - t0, end: timing.startTime - t0 + timing.responseEnd, status: res?.status() });
    }
    if (req.resourceType() === "script" && res) {
      const sizes = await req.sizes().catch(() => null);
      jsBytes += sizes?.responseBodySize ?? 0;
    }
  };
  // Playwright's "networkidle" fires before the app's first API call under CPU throttling, so track requests
  // ourselves: done once nothing has been in flight for 1.5 s after the first paint.
  let inflight = 0;
  let lastActivity = Date.now();
  const onRequest = () => { inflight++; lastActivity = Date.now(); };
  const onDone = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  page.on("requestfinished", onFinished);
  await page.goto(url, { waitUntil: "load" });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const painted = await page.evaluate(() => window.__perf?.fcp > 0).catch(() => false);
    if (painted && inflight === 0 && Date.now() - lastActivity > 1500) break;
    await page.waitForTimeout(200);
  }
  for (const [event, fn] of [["request", onRequest], ["requestfinished", onDone], ["requestfailed", onDone], ["requestfinished", onFinished]]) page.off(event, fn);
  const vitals = await page.evaluate(() => window.__perf);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { ttfb: n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd };
  });
  const apiDone = api.length ? Math.max(...api.map((a) => a.end)) : 0;
  return { finalUrl: page.url(), ...nav, ...vitals, apiCount: api.length, apiDone, jsTransferBytes: jsBytes, api };
}

const browser = await chromium.launch();
const results = [];
for (const [app, name, url] of screens) {
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ ...devices["Pixel 7"], storageState: STATE, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    await context.addInitScript(vitalsScript);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", NETWORK);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
    const first = await measure(page, url);
    const repeat = await measure(page, url); // same context: HTTP cache warm, as on a second open
    results.push({ app, name, run, first, repeat });
    const f = (v) => String(Math.round(v)).padStart(6);
    console.log(`${app.padEnd(8)}${name.padEnd(10)} run${run} first: fcp${f(first.fcp)} lcp${f(first.lcp)} apiDone${f(first.apiDone)} api#${first.apiCount} js${f(first.jsTransferBytes / 1024)}KB cls ${first.cls.toFixed(3)} | repeat: lcp${f(repeat.lcp)} apiDone${f(repeat.apiDone)}  ${first.finalUrl.replace(/^https:\/\/[^/]+/, "")}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(process.argv[2] ?? "perf-results.json", JSON.stringify(results, null, 2));
