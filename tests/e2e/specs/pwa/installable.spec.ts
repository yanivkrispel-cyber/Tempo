import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, expect, test } from "@playwright/test";
import { adminUrl, clientUrl } from "../../support/env";

// Board #347, O1: neither app installed on Android (manifest-missing-suitable-icon). This asks Chrome itself, on a
// phone, whether each app can be installed, and checks that every icon the manifest names is a real PNG. It needs no
// sign-in. Point E2E_ADMIN_URL and E2E_CLIENT_URL at a built preview or at the published dev sites.
//
// The check runs in full Chromium (`channel: "chromium"`): the headless shell Playwright uses by default answers no
// installability errors at all. And it runs in a persistent profile, since Chrome never installs from an incognito
// one and Playwright's usual contexts are incognito ("in-incognito").
const phone = devices["Pixel 7"];

type Image = { src: string; sizes: string; type: string; purpose?: string };

const apps = [
  { app: "client-web", url: clientUrl },
  { app: "admin-web", url: adminUrl },
];

for (const { app, url } of apps) {
  test(`${app} is installable on a phone, by Chrome's own check`, async () => {
    const profile = mkdtempSync(join(tmpdir(), "tempo-pwa-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      viewport: phone.viewport,
      userAgent: phone.userAgent,
      deviceScaleFactor: phone.deviceScaleFactor,
      isMobile: phone.isMobile,
      hasTouch: phone.hasTouch,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: "networkidle" });
      const cdp = await context.newCDPSession(page);
      await expect
        .poll(async () => (await cdp.send("Page.getAppManifest")).url, { message: "Chrome read the manifest" })
        .not.toBe("");
      const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
      expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });

  test(`${app}'s manifest icons answer as PNGs of their declared size`, async ({ request }) => {
    const manifestUrl = new URL("/manifest.webmanifest", url).toString();
    const manifest = (await (await request.get(manifestUrl)).json()) as { icons?: Image[]; screenshots?: Image[] };
    expect(manifest.icons?.length ?? 0, "icons in the manifest").toBeGreaterThanOrEqual(3);
    for (const image of [...(manifest.icons ?? []), ...(manifest.screenshots ?? [])]) {
      const response = await request.get(new URL(image.src, url).toString());
      expect(response.status(), image.src).toBe(200);
      expect(response.headers()["content-type"], image.src).toContain("image/png");
      const bytes = await response.body();
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)].join("x"), image.src).toBe(image.sizes);
    }
  });
}
