import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// Board #530, O3: the profile's referral card reads her link and the reward in one GET (K2) and makes a link only when
// she has none, so a visit spends none of her hourly links and never asks the public link lookup. Sharing still opens
// at once with her link.
test("client-web: the referral card reads her link without making one, and shares it", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const shared: unknown[] = [];
    Object.assign(window, { shared });
    Object.defineProperty(navigator, "share", { value: async (data: unknown) => void shared.push(data) });
  });
  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/me/share-link") || /\/public\/studios\/[^/]+\/links\//.test(path)) {
      calls.push(`${request.method()} ${path.includes("/public/") ? "lookup" : "share-link"}`);
    }
  });

  // The first visit may make her link once if she has none; the second must only read it.
  const firstRead = page.waitForResponse((r) => r.url().includes("/me/share-link?") && r.request().method() === "GET");
  await page.goto("/profile");
  test.skip((await firstRead).status() !== 200, "the API doesn't have the referral read yet (#533)");
  const card = page.getByRole("region", { name: "הביאי חברה" });
  await expect(card.getByRole("button", { name: "שליחה לחברה" })).toBeEnabled();
  await page.waitForLoadState("networkidle");

  calls.length = 0;
  await page.reload();
  const send = card.getByRole("button", { name: "שליחה לחברה" });
  await expect(send).toBeEnabled();
  await page.waitForLoadState("networkidle");
  expect(calls).toEqual(["GET share-link"]);

  await send.click();
  const shared = (await page.evaluate(() => (window as unknown as { shared: { url: string }[] }).shared)) ?? [];
  expect(shared).toHaveLength(1);
  expect(shared[0]!.url).toMatch(/\/s\/[^/]+\/\?src=\w+$/);
  await expectNoSeriousA11yViolations(page, testInfo, "client-web profile referral card");
});
