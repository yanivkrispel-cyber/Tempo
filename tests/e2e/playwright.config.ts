import { defineConfig, devices } from "@playwright/test";
import { adminUrl, clientUrl, sessionStatePath, resolveAppEnv, viteEnv } from "./support/env";

// The dev API and Cognito settings for the two Vite dev servers (support/env.ts). When they cannot be resolved the
// servers still start, from apps/<app>/.env.local if there is one, and the sign-in setup skips.
const appEnv = resolveAppEnv();

export default defineConfig({
  testDir: "./specs",
  // The specs share one studio and one user; run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // The sign-in spec: one real Hosted UI sign-in per app, saved as storage state for the rest.
    { name: "sign-in", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "admin-web",
      testDir: "./specs/admin",
      dependencies: ["sign-in"],
      use: { ...devices["Desktop Chrome"], baseURL: adminUrl, storageState: sessionStatePath },
    },
    {
      name: "client-web",
      testDir: "./specs/client",
      dependencies: ["sign-in"],
      // The member app is a phone PWA.
      use: { ...devices["Pixel 7"], baseURL: clientUrl, storageState: sessionStatePath },
    },
    {
      // The SYNC 2 demo flow crosses both apps, so it takes absolute URLs; both at phone width.
      name: "sync2",
      testDir: "./specs/sync2",
      dependencies: ["sign-in"],
      use: { ...devices["Pixel 7"], storageState: sessionStatePath },
    },
    {
      // The design system's preview page from disk (no app, no sign-in): axe on the primitives at phone width.
      name: "design-system",
      testDir: "./specs/design-system",
      use: { ...devices["Pixel 7"] },
    },
    {
      // SYNC 3, notifications (day board #176): both apps at phone width, absolute URLs.
      name: "sync3",
      testDir: "./specs/sync3",
      dependencies: ["sign-in"],
      use: { ...devices["Pixel 7"], storageState: sessionStatePath },
    },
    {
      // SYNC 4, communications (day board #208): templates, an announcement and its delivery lines, at phone width.
      name: "sync4",
      testDir: "./specs/sync4",
      dependencies: ["sign-in"],
      use: { ...devices["Pixel 7"], storageState: sessionStatePath },
    },
    {
      // SYNC 5, pilot readiness (day board #232, X4): the health declaration, its booking gate and the member's
      // progress, both apps at phone width.
      name: "sync5",
      testDir: "./specs/sync5",
      dependencies: ["sign-in"],
      use: { ...devices["Pixel 7"], storageState: sessionStatePath },
    },
    {
      // SYNC 6, owner reports and deleting a login (day board #253, Y3): a fresh e2e owner and member sign in
      // through the Hosted UI themselves, so no smoke-user session; both apps at phone width.
      name: "sync6",
      testDir: "./specs/sync6",
      use: { ...devices["Pixel 7"] },
    },
    {
      // SYNC 7, member import, notes and tags (day board #321, Z3): a fresh e2e owner at 1280px and a staff member at
      // 360px sign in through the Hosted UI themselves; each sizes its own context (support/screens.ts).
      name: "sync7",
      testDir: "./specs/sync7",
    },
    {
      // SYNC 8, E10 buddies, spots and check-in (day board #347, O4): a fresh e2e owner at 1280px and 360px and two
      // members at 360px sign in through the Hosted UI themselves; each sizes its own context (support/screens.ts).
      name: "sync8",
      testDir: "./specs/sync8",
    },
    {
      // D15 (#317): every screen of both apps on phones, tablets and computers. Each test sizes its own contexts
      // (support/screens.ts). E2E_SCREENSHOTS=1 also keeps a full-page picture of each for review.
      name: "screens",
      testDir: "./specs/screens",
      dependencies: ["sign-in"],
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @tempo/admin-web dev",
      url: adminUrl,
      reuseExistingServer: true,
      timeout: 120_000,
      env: viteEnv(appEnv, "admin-web"),
    },
    {
      command: "pnpm --filter @tempo/client-web dev",
      url: clientUrl,
      reuseExistingServer: true,
      timeout: 120_000,
      env: viteEnv(appEnv, "client-web"),
    },
  ],
});
