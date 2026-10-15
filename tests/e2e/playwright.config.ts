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
