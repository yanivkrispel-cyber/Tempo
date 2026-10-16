import { expect, test } from "@playwright/test";
import { Api, e2eName } from "../../support/api";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { expectFitsNarrowPhone } from "../../support/phone";
import { adminUrl, clientUrl, hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

/**
 * SYNC 4 (day board #208, X5), on a phone (Pixel 7, both apps), against the dev API: the owner words a reminder in
 * the studio's own text, sends an announcement to the whole studio, and finds its delivery lines on the smoke user's
 * person card; the member reads the announcement in the client inbox. The template goes back to what it was, through
 * the API. An announcement cannot be unsent: it is marked `e2e-` and counts against the studio's three a day, so the
 * test skips that part when the allowance is used up.
 */

test.skip(!hasSession(sessionStatePath), noSessionMessage);
test.describe.configure({ mode: "serial" });

const kind = "reminder.class_soon";
type Words = { subject: string; body: string; source: "default" | "studio" };
type Template = { kind: string; version: string; channels: { inbox: Words; push: Words } };
type Allowance = { recipients: number; sentToday: number; dailyLimit: number; maxRecipients: number };

let api: Api;
let savedTemplate: Template | undefined;
const subject = e2eName("sync4");

test.beforeAll(async () => {
  api = await Api.open();
});

test.afterAll(async () => {
  if (!api) return;
  if (savedTemplate) {
    const current = await api.call<Template>("GET", `/notification-templates/${kind}`, { params: { locale: "he" } });
    const words = (channel: Words) =>
      channel.source === "studio" ? { subject: channel.subject, body: channel.body } : null;
    await api.call("PUT", `/notification-templates/${kind}`, {
      data: { locale: "he", inbox: words(savedTemplate.channels.inbox), push: words(savedTemplate.channels.push) },
      headers: { "If-Match": current.version },
    });
  }
  await api.dispose();
});

test("console: the owner words the class-soon reminder and sees it live", async ({ page }, testInfo) => {
  savedTemplate = await api.call<Template>("GET", `/notification-templates/${kind}`, { params: { locale: "he" } });

  await page.goto(`${adminUrl}/o/${studioSlug}/settings`);
  const card = page.getByRole("region", { name: "נוסחי ההודעות" });
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: "תזכורת זמן קצר לפני שיעור" }).click();
  await expect(page.getByRole("tab", { name: "תיבת ההודעות" })).toBeVisible();

  const body = page.getByRole("textbox", { name: "גוף ההודעה" });
  await body.fill(`${subject}: נתראה ב`);
  await page.getByRole("button", { name: "שם הסטודיו" }).click();
  const preview = page.getByRole("group", { name: "תצוגה מקדימה של הודעה בתיבה" });
  await expect(preview).toContainText(`${subject}: נתראה ב`);
  await expect(preview).not.toContainText("{{studio.name}}");
  await expectNoSeriousA11yViolations(page, testInfo, "console template editor");
  await expectFitsNarrowPhone(page, testInfo, "console template editor");

  await page.getByRole("button", { name: "שמירת הנוסח" }).click();
  await expect(page.getByText("הנוסח נשמר", { exact: true }).first()).toBeVisible();
  const saved = await api.call<Template>("GET", `/notification-templates/${kind}`, { params: { locale: "he" } });
  expect(saved.channels.inbox.source).toBe("studio");
  expect(saved.channels.inbox.body).toBe(`${subject}: נתראה ב{{studio.name}}`);

  await page.getByRole("button", { name: "חזרה לנוסח של Tempo" }).click();
  await expect(page.getByText("הנוסח חזר לנוסח של Tempo", { exact: true }).first()).toBeVisible();
});

test("console and client-web: an announcement reaches the member and shows on the person card", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const allowance = await api.call<Allowance>("GET", "/announcements");
  test.skip(allowance.sentToday >= allowance.dailyLimit, "The studio already sent today's announcements.");
  test.skip(
    allowance.recipients > allowance.maxRecipients,
    "The dev studio has more people than one announcement takes.",
  );

  await page.goto(`${adminUrl}/o/${studioSlug}/schedule`);
  await page.getByRole("button", { name: "הודעה לכל הסטודיו" }).click();
  const dialog = page.getByRole("dialog", { name: "הודעה לכל הסטודיו" });
  await dialog.getByRole("textbox", { name: "נושא" }).fill(subject);
  await dialog.getByRole("textbox", { name: "ההודעה" }).fill("בדיקה אוטומטית של **Tempo**. אין צורך לעשות דבר.");
  await expect(dialog.getByRole("group", { name: "תצוגה מקדימה של הודעה בתיבה" })).toContainText(subject);
  await expectNoSeriousA11yViolations(page, testInfo, "console announcement dialog", "[role='dialog']");
  await expectFitsNarrowPhone(page, testInfo, "console announcement dialog", "[role='dialog']");
  await dialog.getByRole("button", { name: /^שליחה ל־/ }).click();
  await expect(dialog).toBeHidden();

  // The member's inbox holds it; client-web marks it read once shown, as it has nothing to open.
  type Inbox = { items: { id: string; kind: string; title?: string | null; readAt?: string | null }[] };
  const ownItem = async () =>
    (await api.call<Inbox>("GET", "/me/notifications")).items.find(
      (item) => item.kind === "studio.announcement" && item.title === subject,
    );
  await expect.poll(async () => Boolean(await ownItem()), { timeout: 60_000, intervals: [3_000] }).toBe(true);

  await page.goto(`${clientUrl}/inbox`);
  const notice = page.getByRole("listitem").filter({ hasText: subject });
  await expect(notice).toBeVisible();
  await expect(notice.locator("strong", { hasText: "Tempo" })).toBeVisible();
  await expect(notice.getByText("חדש")).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "client-web inbox with an announcement");
  await expectFitsNarrowPhone(page, testInfo, "client-web inbox with an announcement");
  await expect.poll(async () => Boolean((await ownItem())?.readAt), { timeout: 30_000 }).toBe(true);

  // The studio sees the smoke user's delivery line, without the text.
  const own = await api.ownPerson();
  if (!own) throw new Error("The smoke user has no person record in the studio.");
  await page.goto(`${adminUrl}/o/${studioSlug}/people/${own.id}`);
  const deliveries = page.getByRole("region", { name: "התראות אחרונות" });
  await expect(deliveries.getByRole("row").filter({ hasText: "הודעה לכל הסטודיו" }).first()).toBeVisible();
  await expect(deliveries).not.toContainText(subject);
  await expectNoSeriousA11yViolations(
    page,
    testInfo,
    "console person deliveries",
    "section[aria-labelledby='deliveries']",
  );
  await expectFitsNarrowPhone(page, testInfo, "console person deliveries", "section[aria-labelledby='deliveries']");
});
