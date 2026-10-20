import { chromium, devices } from "@playwright/test";
const b = await chromium.launch();
const c = await b.newContext({ ...devices["Pixel 7"], storageState: ".auth/smoke-user.json" });
await c.addInitScript(() => { window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(3), src: e.sources.map((s) => { const n = s.node; return n ? `${n.nodeName}.${(n.className && n.className.baseVal === undefined ? n.className : "").toString().split(" ").slice(0,2).join(".")} h:${s.previousRect.height}->${s.currentRect.height} y:${s.previousRect.y}->${s.currentRect.y}` : "?"; }) }); }).observe({ type: "layout-shift", buffered: true }); });
for (const url of process.argv.slice(2)) {
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.goto(url); await p.waitForTimeout(6000);
  console.log("==", url); for (const s of await p.evaluate(() => window.__shifts)) console.log(" ", s.t, s.v, s.src.join(" | "));
  await p.close();
}
await b.close();
