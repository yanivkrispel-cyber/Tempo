import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

test("client-web home: greets the signed-in member by first name", async ({ page }, testInfo) => {
  // The greeting uses the account's display name, else the email before "@" (apps/client-web account.ts).
  const session = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/session") && response.request().method() === "POST",
  );
  await page.goto("/");
  const me = (await (await session).json()) as { displayName: string | null; email: string };
  const firstName = (me.displayName?.trim() || me.email.split("@")[0] || me.email).split(" ")[0] ?? "";

  await expect(page.getByRole("heading", { level: 1, name: `היי ${firstName}` })).toBeVisible();
  await expect(page.getByRole("link", { name: /^התראות/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web home");
});
