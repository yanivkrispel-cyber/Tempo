import { expect, test, type Locator } from "@playwright/test";
import { Api, e2eName } from "../../support/api";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { expectFitsNarrowPhone } from "../../support/phone";
import {
  adminUrl,
  aws,
  clientUrl,
  hasSession,
  noSessionMessage,
  sessionStatePath,
  studioSlug,
} from "../../support/env";
import { createSession, removeE2eSchedule, studioDay } from "../../support/studio";

/**
 * SYNC 3 (day board #176, S5), on a phone (Pixel 7, both apps), against the dev API: the member saves notification
 * preferences in client-web, the owner saves the studio's reminder timing in the console, and a reminder written by
 * the worker's hourly job reaches the member's inbox. The saved values go back afterwards, through the API, so the
 * smoke user keeps its settings, and the e2e class, card and booking are removed.
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
let ownPersonId: string | undefined;

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
  if (ownPersonId) await removeE2eSchedule(api, ownPersonId);
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
  await expectFitsNarrowPhone(page, testInfo, "client-web notification preferences");

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
  await expectFitsNarrowPhone(page, testInfo, "console notification settings", "section[aria-label='התראות ותזכורות']");

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

test("client-web: an entries-low reminder from the hourly job reaches the inbox", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const own = await api.ownPerson();
  if (!own) throw new Error("The smoke user has no person record in the studio.");
  ownPersonId = own.id;
  await removeE2eSchedule(api, own.id);

  // A two-entry card for the smoke user and one booking with it: one entry left, the studio's default "entries low".
  // A booking takes the card that ends first (PassSelection), so this one lasts two days and the class is tomorrow.
  const productName = e2eName("sync3-card");
  await api.call("POST", "/pass-products", {
    data: { kind: "punch_card", name: productName, entries: 2, validDays: 2 },
  });
  await api.call("POST", `/people/${own.id}/passes`, {
    data: { productId: await productIdOf(productName), note: "e2e" },
  });
  const passes = await api.call<{ items: { id: string; product: { name: string } }[] }>(
    "GET",
    `/people/${own.id}/passes`,
  );
  const passId = passes.items.find((pass) => pass.product.name === productName)?.id;
  if (!passId) throw new Error("The e2e card was not granted.");
  const roomId = (
    await api.call<{ id: string }>("POST", "/rooms", { data: { name: e2eName("sync3-room"), defaultCapacity: 5 } })
  ).id;
  const classTypeId = (
    await api.call<{ id: string }>("POST", "/class-types", {
      data: { name: e2eName("sync3-class"), category: "pilates", color: "sage", defaultMinutes: 30 },
    })
  ).id;
  const sessionId = await createSession(api, {
    classTypeId,
    roomId,
    localDate: studioDay(1),
    localStart: "23:00",
    capacity: 5,
  });
  await api.call("POST", `/sessions/${sessionId}/bookings`, { data: { personId: own.id } });

  const used = await api.call<{ items: { id: string; entriesLeft?: number | null }[] }>(
    "GET",
    `/people/${own.id}/passes`,
  );
  expect(used.items.find((pass) => pass.id === passId)?.entriesLeft, "the booking used the e2e card").toBe(1);

  // The hourly tick, as EventBridge Scheduler sends it (infrastructure: NotificationRemindersSchedule).
  const queueUrl = aws(["sqs", "get-queue-url", "--queue-name", "tempo-dev-work", "--query", "QueueUrl"]);
  if (!queueUrl) throw new Error("The AWS CLI could not find the dev work queue.");
  const sent = aws([
    "sqs",
    "send-message",
    "--queue-url",
    queueUrl,
    "--message-body",
    "{}",
    "--message-attributes",
    "MessageType={DataType=String,StringValue=notifications.reminders_hourly}",
    "--query",
    "MessageId",
  ]);
  if (!sent) throw new Error("The reminder tick was not sent.");

  type Inbox = { items: { id: string; kind: string; data: { passId?: string } }[] };
  let itemId: string | undefined;
  await expect
    .poll(
      async () => {
        const inbox = await api.call<Inbox>("GET", "/me/notifications");
        itemId = inbox.items.find((item) => item.kind === "reminder.entries_low" && item.data.passId === passId)?.id;
        return Boolean(itemId);
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toBe(true);

  await page.goto(`${clientUrl}/inbox`);
  await expect(page.getByRole("heading", { level: 1, name: "התראות" })).toBeVisible();
  await expect(page.getByText("נשארו מעט כניסות בכרטיסייה").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web inbox with a reminder");
  await expectFitsNarrowPhone(page, testInfo, "client-web inbox with a reminder");
  await api.call("POST", `/me/notifications/${itemId}/read`);
});

async function productIdOf(name: string): Promise<string> {
  const products = await api.call<{ items: { id: string; name: string }[] }>("GET", "/pass-products");
  const product = products.items.find((item) => item.name === name);
  if (!product) throw new Error(`No product ${name}.`);
  return product.id;
}

/** A design-system switch hides its input behind the track (shared/design-system/Toggle.tsx): click its label. */
function flip(toggle: Locator): Promise<void> {
  return toggle.locator("xpath=..").click();
}
