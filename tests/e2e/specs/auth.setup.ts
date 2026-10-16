import { mkdirSync, rmSync } from "node:fs";
import { expect, test as setup, type Page } from "@playwright/test";
import { Api } from "../support/api";
import { expectNoSeriousA11yViolations } from "../support/axe";
import { smokeUser, type SmokeUser } from "../support/credentials";
import {
  adminUrl,
  authDir,
  clientUrl,
  noSessionMessage,
  resolveAppEnv,
  sessionStatePath,
  studioSlug,
} from "../support/env";

// The password is typed into the Hosted UI here; a trace, screenshot or video would keep it.
setup.use({ trace: "off", screenshot: "off", video: "off" });

setup(
  "sign-in: the smoke user signs in to admin-web and client-web through the Cognito Hosted UI",
  async ({ page, context }, testInfo) => {
    // A state from an earlier run must not make the specs run when this sign-in is skipped or fails.
    rmSync(sessionStatePath, { force: true });

    const appEnv = resolveAppEnv();
    setup.skip(
      !appEnv,
      "The dev API and Cognito settings are not resolved: set the E2E_* variables or sign in to AWS. See tests/e2e/README.md.",
    );
    const user = smokeUser();
    setup.skip(!user, noSessionMessage);
    if (!user) return;

    // admin-web: our sign-in page, then the Hosted UI with the password.
    await page.goto(`${adminUrl}/login`);
    await expect(page.getByRole("heading", { level: 1, name: /ניהול הסטודיו/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, "admin-web /login");
    await page.getByRole("button", { name: "התחברות" }).click();
    await signInOnHostedUi(page, user);
    await page.waitForURL(
      (url) => url.origin === adminUrl && !url.pathname.startsWith("/auth/") && url.pathname !== "/login",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // client-web: same user pool, its own app client. The Hosted UI session cookie usually signs it straight in.
    await page.goto(`${clientUrl}/login`);
    await expect(page.getByRole("heading", { level: 1, name: /ברוכים הבאים/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, "client-web /login");
    await page.getByRole("button", { name: "התחברות" }).click();
    await page.waitForURL((url) => url.origin !== clientUrl || !url.pathname.startsWith("/login"));
    if (new URL(page.url()).origin !== clientUrl) await signInOnHostedUi(page, user);
    await page.waitForURL(
      (url) => url.origin === clientUrl && !url.pathname.startsWith("/auth/") && url.pathname !== "/login",
      { timeout: 30_000 },
    );

    mkdirSync(authDir, { recursive: true });
    await context.storageState({ path: sessionStatePath });

    // The specs work only in the smoke studio; make sure the user can reach it before they start.
    const api = await Api.open().catch(async (error: unknown) => {
      rmSync(sessionStatePath, { force: true });
      throw new Error(`${(error as Error).message} The specs need ${studioSlug}, owned by the smoke user.`);
    });
    await api.dispose();
  },
);

/** Fills the classic Hosted UI form. It renders two copies (desktop and mobile); only one is visible. */
async function signInOnHostedUi(page: Page, user: SmokeUser): Promise<void> {
  await page.waitForURL((url) => url.hostname.endsWith(".amazoncognito.com"));
  await page.locator('input[name="username"]:visible').fill(user.email);
  await page.locator('input[name="password"]:visible').fill(user.password);
  await page.locator('input[name="signInSubmitButton"]:visible').click();
}
