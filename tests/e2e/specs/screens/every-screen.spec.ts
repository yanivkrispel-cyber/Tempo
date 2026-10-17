import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Api } from "../../support/api";
import { adminUrl, clientUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";
import {
  SCREENS,
  annotateFit,
  keepScreenshot,
  measureFit,
  openScreen,
  screenshotDir,
  settle,
} from "../../support/screens";
import { sessionsBetween, studioDay } from "../../support/studio";

// D15 (docs/claude-memory/decisions.md, #317): every screen of both apps works on a phone, a tablet and a computer.
// Each route opens at every size in SCREENS; nothing may scroll sideways, and on touch screens every control is at
// least 44px. Read-only: it only opens screens in the smoke studio.
// Each test opens one route at all six sizes.
test.describe.configure({ timeout: 180_000 });

let personId = "";
let sessionId = "";

test.beforeAll(async () => {
  // Checked here, at run time: the sign-in setup writes the session after Playwright has collected this file.
  test.skip(!hasSession(sessionStatePath), noSessionMessage);
  const api = await Api.open();
  try {
    personId = (await api.ownPerson())?.id ?? "";
    const upcoming = await sessionsBetween(api, studioDay(0), studioDay(7));
    sessionId = upcoming.find((session) => session.status === "scheduled")?.id ?? upcoming[0]?.id ?? "";
  } finally {
    await api.dispose();
  }
});

const console_ = (path: string) => `${adminUrl}/o/${studioSlug}${path}`;

const routes: { app: "admin-web" | "client-web"; name: string; url: () => string; signedIn?: false }[] = [
  { app: "admin-web", name: "login", url: () => `${adminUrl}/login`, signedIn: false },
  { app: "admin-web", name: "select-studio", url: () => `${adminUrl}/select-organization` },
  { app: "admin-web", name: "account-security", url: () => `${adminUrl}/account/security` },
  { app: "admin-web", name: "today", url: () => console_("/today") },
  { app: "admin-web", name: "members", url: () => console_("") },
  { app: "admin-web", name: "invitations", url: () => console_("/invitations") },
  { app: "admin-web", name: "roles", url: () => console_("/roles") },
  { app: "admin-web", name: "people", url: () => console_("/people") },
  { app: "admin-web", name: "person", url: () => console_(`/people/${personId}`) },
  { app: "admin-web", name: "people-import", url: () => console_("/people/import") },
  { app: "admin-web", name: "duplicates", url: () => console_("/duplicates") },
  { app: "admin-web", name: "schedule", url: () => console_("/schedule") },
  { app: "admin-web", name: "session", url: () => console_(`/schedule/sessions/${sessionId}`) },
  { app: "admin-web", name: "weekly-classes", url: () => console_("/weekly-classes") },
  { app: "admin-web", name: "class-types", url: () => console_("/class-types") },
  { app: "admin-web", name: "rooms", url: () => console_("/rooms") },
  { app: "admin-web", name: "passes", url: () => console_("/passes") },
  { app: "admin-web", name: "settings", url: () => console_("/settings") },
  { app: "admin-web", name: "template", url: () => console_("/settings/templates/reminder.class_tomorrow") },
  { app: "admin-web", name: "audit", url: () => console_("/audit") },
  { app: "admin-web", name: "reports", url: () => console_("/reports") },
  { app: "client-web", name: "login", url: () => `${clientUrl}/login`, signedIn: false },
  { app: "client-web", name: "home", url: () => `${clientUrl}/` },
  { app: "client-web", name: "book", url: () => `${clientUrl}/book` },
  { app: "client-web", name: "class", url: () => `${clientUrl}/classes/${sessionId}` },
  { app: "client-web", name: "bookings", url: () => `${clientUrl}/bookings` },
  { app: "client-web", name: "inbox", url: () => `${clientUrl}/inbox` },
  { app: "client-web", name: "profile", url: () => `${clientUrl}/profile` },
  { app: "client-web", name: "notifications", url: () => `${clientUrl}/profile/notifications` },
  { app: "client-web", name: "health", url: () => `${clientUrl}/profile/health` },
];

for (const route of routes) {
  test(`${route.app} ${route.name} fits every screen`, async ({ browser }, testInfo) => {
    for (const screen of SCREENS) {
      const context = await openScreen(browser, screen, route.signedIn === false ? undefined : sessionStatePath);
      try {
        const page = await context.newPage();
        await page.goto(route.url());
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await settle(page);
        const fit = await measureFit(page, screen);
        const label = `${route.app} ${route.name} @ ${screen.name}`;
        annotateFit(testInfo, label, fit);
        if (process.env.E2E_SCREENSHOTS === "1") {
          mkdirSync(screenshotDir, { recursive: true });
          appendFileSync(
            join(screenshotDir, "fit.jsonl"),
            `${JSON.stringify({ app: route.app, route: route.name, screen: screen.name, ...fit })}\n`,
          );
        }
        await keepScreenshot(page, route.app, route.name, screen);
        expect.soft(fit.overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
        expect.soft(fit.smallTargets, `${label} has controls under 44px`).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });
}
