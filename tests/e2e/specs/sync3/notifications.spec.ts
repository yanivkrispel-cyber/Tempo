import { expect, test, type Locator } from "@playwright/test";
import { Api } from "../../support/api";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { adminUrl, clientUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

/**
 * SYNC 3 (day board #176, S5), on a phone (Pixel 7, both apps), against the dev API: the member saves notification
 * preferences in client-web and the owner saves the studio's quiet hours and reminder timing in the console. Each
 * test puts the saved values back afterwards, through the API, so the smoke user keeps its settings.
 */

test.skip(!hasSession(sessionStatePath), noSessionMessage);
test.describe.configure({ mode: "serial" });

type Preferences = {
  groups: { group: string; channels: { inbox: boolean; push: boolean } }[];
  reminders: Record<string, boolean>;
  quietHours: { startsLocal: string; endsLocal: string } | null;
  version: string;
};
type Settings = {
  quietHours: { startsLocal: string; endsLocal: string };
  reminders: Record<string, Record<string, unknown>>;
  version: string;
};

let api: Api;
let savedPreferences: Preferences | undefined;
let savedSettings: Settings | undefined;

test.beforeAll(async () => {
  api = await Api.open();
});

test.afterAll(async () => {
  if (!api) return;
  if (savedPreferences) {
    const current = await api.call<Preferences>("GET", "/me/notification-preferences");
    const { groups, reminders, quietHours } = savedPreferences;
    await api.call("PUT", "/me/notification-preferences", {
      data: { groups, reminders, quietHours },
      headers: { "If-Match": current.version },
    });
  }
  if (savedSettings) {
    const current = await api.call<Settings>("GET", "/notification-settings");
    const { quietHours, reminders } = savedSettings;
    await api.call("PUT", "/notification-settings", {
      data: { quietHours, reminders },
      headers: { "If-Match": current.version },
    });
  }
  await api.dispose();
});

test("client-web: the member turns off studio push and sets own quiet hours", async ({ page }, testInfo) => {
  savedPreferences = await api.call<Preferences>("GET", "/me/notification-preferences");
  // Start from a known state: push on for studio messages, the studio's quiet hours.
  await api.call("PUT", "/me/notification-preferences", {
    data: {
      groups: savedPreferences.groups.map((group) => ({ ...group, channels: { inbox: true, push: true } })),
      reminders: savedPreferences.reminders,
      quietHours: null,
    },
    headers: { "If-Match": savedPreferences.version },
  });

  await page.goto(`${clientUrl}/profile`);
  await page.getByRole("link", { name: /העדפות התראות/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "העדפות התראות" })).toBeVisible();
  const studioPush = page.getByRole("switch", { name: "הודעות מהסטודיו: התראה בטלפון" });
  await expect(studioPush).toBeChecked();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web notification preferences");

  await flip(studioPush);
  await page.getByRole("radio", { name: "שעות משלי" }).check();
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("ההעדפות נשמרו", { exact: true }).first()).toBeVisible();

  // Saved on the server: a fresh load shows the same.
  await page.reload();
  await expect(page.getByRole("switch", { name: "הודעות מהסטודיו: התראה בטלפון" })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "שעות משלי" })).toBeChecked();
  const saved = await api.call<Preferences>("GET", "/me/notification-preferences");
  expect(saved.groups.find((group) => group.group === "studio")?.channels).toEqual({ inbox: true, push: false });
  expect(saved.quietHours).not.toBeNull();
});

test("console: the owner changes the class-soon reminder timing", async ({ page }, testInfo) => {
  savedSettings = await api.call<Settings>("GET", "/notification-settings");
  const hoursBefore = savedSettings.reminders.classSoon?.hoursBefore === 3 ? 4 : 3;

  await page.goto(`${adminUrl}/o/${studioSlug}/settings`);
  const card = page.getByRole("region", { name: "התראות ותזכורות" });
  await expect(card).toBeVisible();
  await expectNoSeriousA11yViolations(
    page,
    testInfo,
    "console notification settings",
    "section[aria-label='התראות ותזכורות']",
  );

  const classSoon = card.getByRole("switch", { name: "זמן קצר לפני שיעור" });
  if (!(await classSoon.isChecked())) await flip(classSoon);
  await card.getByRole("combobox", { name: "כמה זמן לפני" }).selectOption(String(hoursBefore));
  await card.getByRole("button", { name: "שמירת הגדרות ההתראות" }).click();
  await expect(page.getByText("הגדרות ההתראות נשמרו", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("region", { name: "התראות ותזכורות" }).getByRole("combobox", { name: "כמה זמן לפני" }),
  ).toHaveValue(String(hoursBefore));
  const saved = await api.call<Settings>("GET", "/notification-settings");
  expect(saved.reminders.classSoon).toEqual({ enabled: true, hoursBefore });
});

/** A design-system switch hides its input behind the track (shared/design-system/Toggle.tsx): click its label. */
function flip(toggle: Locator): Promise<void> {
  return toggle.locator("xpath=..").click();
}
