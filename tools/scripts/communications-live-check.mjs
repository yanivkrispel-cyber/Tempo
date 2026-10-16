#!/usr/bin/env node
/**
 * The communications live check on dev (day board #208, T5; docs/30 section 13 step 7), after the P6 notifications
 * check.
 *
 * As the smoke user, in its studio:
 *   1. templates: an unknown variable is refused (400 `template.unknown_variable` with the field); the studio's own
 *      words for `reminder.entries_low` are saved and previewed on the demo values
 *   2. the next entries-low reminder (fired by hand, as in P6) reaches the inbox with the studio's words, and its
 *      push line is written
 *   3. announcements: sent until the day's limit, each reaching the smoke user's inbox with its subject and text;
 *      the one after the limit is refused (429 `announcement.daily_limit` with Retry-After)
 *   4. the smoke user's delivery lines read back: the reminder and the announcements, without text or address
 *   5. the API and worker logs since the start hold none of the texts, the test address or the smoke user's email
 *   6. the Neon project's usage before and after
 *
 * Every announcement reaches every active member of the smoke studio (fictional `example.com` people on dev) and
 * uses up the studio's day: run it once a day at most.
 *
 * Cleanup: the studio's words go back to what they were, the booking is cancelled, the card product archived, the
 * test subscription deleted if FCM left it, the preferences restored. Announcements are never rewritten; the
 * retention job removes them with their inbox items.
 *
 * Usage (from a developer's machine; `--profile tempo` needs cognito-idp:AdminInitiateAuth, ssm:GetParameter,
 * cloudformation:DescribeStacks, sqs:GetQueueUrl, sqs:SendMessage and logs:FilterLogEvents):
 *   node tools/scripts/communications-live-check.mjs [--profile tempo]
 *
 * Never prints secret values, the texts' markers or the smoke user's address.
 */

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const NEON_API = "https://console.neon.tech/api/v2";
// The dev project, as in infrastructure/config/development.ts.
const NEON_PROJECT_ID = "wild-darkness-22822656";
const PREFIX = "בדיקת תקשורת: ";
const KIND = "reminder.entries_low";
// RFC 8291 appendix A: published example keys, no real device.
const BROWSER_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const BROWSER_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
// One marker per run in every text written, so the logs can be searched for it.
const MARK = `lc${randomBytes(6).toString("hex")}`;

const profileIndex = process.argv.indexOf("--profile");
const profile = profileIndex > 0 ? process.argv[profileIndex + 1] : "tempo";
const started = Date.now();

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const ssm = (name) => JSON.parse(aws(["ssm", "get-parameter", "--name", name, "--with-decryption"])).Parameter.Value;

/** Runs `aws <args> --cli-input-json` from a private temporary file, so no value lands on a command line. */
function awsWithInput(cliArgs, input) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-comms-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(aws([...cliArgs, "--cli-input-json", `file://${file}`]) || "{}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The project's usage this billing period, from the same endpoint the neon-usage Lambda reads. */
async function neonUsage() {
  const response = await fetch(`${NEON_API}/projects/${NEON_PROJECT_ID}`, {
    headers: { Authorization: `Bearer ${ssm("/tempo/dev/neon/api-key")}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Neon API → ${response.status}`);
  const { project } = await response.json();
  return {
    computeSeconds: project.compute_time_seconds,
    egressBytes: project.data_transfer_bytes,
    storageBytes: project.synthetic_storage_size,
  };
}

const outputs = JSON.parse(aws(["cloudformation", "describe-stacks", "--stack-name", "TempoDev-Identity"])).Stacks[0]
  .Outputs;
const out = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;
const smokePath = out("SmokeTestParameterPath");
const smokeEmail = ssm(`${smokePath}/email`);
const token = awsWithInput(["cognito-idp", "admin-initiate-auth"], {
  UserPoolId: out("UserPoolId"),
  ClientId: out("ClientWebClientId"),
  AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
  AuthParameters: { USERNAME: smokeEmail, PASSWORD: ssm(`${smokePath}/password`) },
}).AuthenticationResult.AccessToken;

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};

async function call(method, route, body, { expected = [200, 201, 204], ifMatch } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(ifMatch === undefined ? {} : { "If-Match": ifMatch }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!expected.includes(response.status)) {
    failures += 1;
    console.log(`✗ ${method} ${route.replace(/\/organizations\/[0-9a-f-]+/, "/{studio}")} → ${response.status} ${text.slice(0, 200).replaceAll(MARK, "<mark>")}`);
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the status says enough.
  }
  return { status: response.status, json, text, retryAfter: response.headers.get("retry-after") };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const fresh = (item) => Date.parse(item.createdAt) >= started - 5000;

const before = await neonUsage();
console.log(`Neon before: compute ${before.computeSeconds} s, egress ${before.egressBytes} B, storage ${before.storageBytes} B`);

const me = (await call("GET", "/api/v1/me")).json;
const membership = me.memberships.find(
  (m) => m.permissions.includes("organization.settings.manage") && m.permissions.includes("bookings.manage"),
);
const s = `/api/v1/organizations/${membership.organization.id}`;
const person = (await call("GET", `${s}/people?query=${encodeURIComponent(smokeEmail)}`)).json.items[0];

const originalTemplate = (await call("GET", `${s}/notification-templates/${KIND}?locale=he`)).json;
const words = (channel) => {
  const text = originalTemplate.channels[channel];
  return text.source === "studio" ? { subject: text.subject, body: text.body } : null;
};
const originalPreferences = (await call("GET", `${s}/me/notification-preferences`)).json;
let subscription;
let product;
let booking;
let endpoint;
const announced = [];
try {
  // 1. Templates.
  const unknown = await call(
    "PUT",
    `${s}/notification-templates/${KIND}`,
    { locale: "he", inbox: { subject: "{{person.email}}", body: "x" }, push: null },
    { ifMatch: originalTemplate.version, expected: [400] },
  );
  check(
    unknown.status === 400 && unknown.text.includes("template.unknown_variable") && unknown.text.includes("inbox.subject"),
    "templates: an unknown variable is refused (400 template.unknown_variable, field inbox.subject)",
  );
  const studioWords = {
    locale: "he",
    inbox: { subject: `${PREFIX}{{person.firstName}} ${MARK}`, body: `נשארו מעט כניסות ב**{{studio.name}}**. ${MARK}` },
    push: { subject: `${PREFIX}כניסות ${MARK}`, body: `{{person.firstName}}, כדאי לחדש. ${MARK}` },
  };
  const saved = (
    await call("PUT", `${s}/notification-templates/${KIND}`, studioWords, { ifMatch: originalTemplate.version })
  ).json;
  check(
    saved?.channels.inbox.source === "studio" &&
      saved.channels.push.source === "studio" &&
      saved.channels.inbox.preview.subject.includes(saved.sampleValues["person.firstName"]) &&
      !saved.channels.inbox.preview.subject.includes("{{"),
    "templates: the studio's words are saved for inbox and push and previewed on the demo values",
  );

  // 2. The next reminder uses them: push and inbox on for every group, a test address no device holds, a
  // two-entry card with one class booked, and the hourly reminder message fired by hand.
  const current = (await call("GET", `${s}/me/notification-preferences`)).json;
  await call(
    "PUT",
    `${s}/me/notification-preferences`,
    {
      groups: current.groups.map((g) => ({ group: g.group, channels: { inbox: true, push: true } })),
      reminders: { ...current.reminders, entriesLow: true },
      // Own quiet hours away from the run, as in P6, so the studio's window does not hold the push.
      quietHours: { startsLocal: "03:00", endsLocal: "04:00" },
    },
    { ifMatch: current.version },
  );
  endpoint = `https://fcm.googleapis.com/fcm/send/tempo-live-check-${randomUUID()}`;
  subscription = (
    await call("POST", `${s}/me/push-subscriptions`, {
      endpoint,
      keys: { p256dh: BROWSER_KEY, auth: BROWSER_AUTH },
      deviceLabel: "Live check",
    })
  ).json;
  // A four-day card ends before the cards earlier checks left on the smoke user, so the booking uses it.
  product = (
    await call("POST", `${s}/pass-products`, { kind: "punch_card", name: `${PREFIX}כרטיסייה`, entries: 2, validDays: 4, priceAgorot: 0 })
  ).json;
  const pass = (await call("POST", `${s}/people/${person.id}/passes`, { productId: product.id, note: "communications live check" })).json;
  const earliest = new Date(Date.now() + 26 * 3_600_000).toISOString();
  const session = (await call("GET", `${s}/sessions?from=${today()}&to=${addDays(today(), 30)}`)).json.items
    .filter((x) => x.status === "scheduled" && x.startsAt > earliest && x.localDate < addDays(today(), 3) && x.bookedCount < x.capacity)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  booking = (await call("POST", `${s}/sessions/${session.id}/bookings`, { personId: person.id })).json;
  check(booking?.pass?.id === pass?.id, "the booking used the new card, so it has one entry left");
  const queueUrl = JSON.parse(aws(["sqs", "get-queue-url", "--queue-name", "tempo-dev-work"])).QueueUrl;
  awsWithInput(["sqs", "send-message"], {
    QueueUrl: queueUrl,
    MessageBody: "{}",
    MessageAttributes: { MessageType: { DataType: "String", StringValue: "notifications.reminders_hourly" } },
  });
  console.log("fired notifications.reminders_hourly on the work queue");
  let reminder;
  for (let i = 0; i < 12 && !reminder; i += 1) {
    await sleep(5000);
    reminder = (await call("GET", `${s}/me/notifications`)).json?.items?.find((item) => item.kind === KIND && fresh(item));
  }
  check(
    reminder?.title?.startsWith(PREFIX) && reminder.title.includes(MARK) && !reminder.title.includes("{{") && reminder.body?.includes(MARK),
    "templates: the next entries-low reminder reached the inbox in the studio's words, variables filled",
  );

  // 3. Announcements up to the day's limit, then one more.
  const allowance = (await call("GET", `${s}/announcements`)).json;
  console.log(`announcements: ${allowance.recipients} active members, ${allowance.sentToday} of ${allowance.dailyLimit} sent today`);
  for (let n = allowance.sentToday; n < allowance.dailyLimit; n += 1) {
    const subject = `${PREFIX}הודעה ${n + 1} ${MARK}`;
    const sent = await call("POST", `${s}/announcements`, { subject, body: `**שלום** לכל הסטודיו. ${MARK}` }, { expected: [201] });
    if (sent.status === 201) announced.push({ ...sent.json, subject });
  }
  check(
    announced.length === allowance.dailyLimit - allowance.sentToday && announced.every((a) => a.recipients === allowance.recipients),
    `announcements: ${announced.length} sent, each to all ${allowance.recipients} active members`,
  );
  const refused = await call("POST", `${s}/announcements`, { subject: `${PREFIX}${MARK}`, body: MARK }, { expected: [429] });
  check(
    refused.status === 429 && refused.text.includes("announcement.daily_limit") && Number(refused.retryAfter) > 0,
    `announcements: the one after the limit is refused (429 announcement.daily_limit, Retry-After ${refused.retryAfter} s)`,
  );
  let inbox = [];
  for (let i = 0; i < 6; i += 1) {
    inbox = (await call("GET", `${s}/me/notifications`)).json?.items?.filter((item) => item.kind === "studio.announcement" && fresh(item)) ?? [];
    if (inbox.length >= announced.length) break;
    await sleep(5000);
  }
  check(
    announced.every((a) => inbox.some((item) => item.title === a.subject && item.text?.includes(MARK))),
    "announcements: each reached the smoke user's inbox with its subject and text",
  );

  // 4. The delivery lines read back.
  await sleep(10000);
  const log = await call("GET", `${s}/people/${person.id}/deliveries`);
  const lines = log.json?.items ?? [];
  const recent = lines.filter((line) => Date.parse(line.createdAt) >= started - 5000);
  console.log(`deliveries: ${recent.map((line) => `${line.kind}/${line.channel}/${line.status}${line.reason ? `(${line.reason})` : ""}`).join(", ")}`);
  check(
    recent.some((line) => line.kind === KIND && line.channel === "inbox") && recent.some((line) => line.kind === KIND && line.channel === "push"),
    "deliveries: the reminder's inbox and push lines",
  );
  check(
    recent.filter((line) => line.kind === "studio.announcement" && line.channel === "inbox").length === announced.length,
    "deliveries: one inbox line per announcement",
  );
  check(!log.text.includes(MARK) && !log.text.includes("fcm.googleapis.com"), "deliveries: no text and no address");
} finally {
  const template = (await call("GET", `${s}/notification-templates/${KIND}?locale=he`)).json;
  await call("PUT", `${s}/notification-templates/${KIND}`, { locale: "he", inbox: words("inbox"), push: words("push") }, { ifMatch: template.version });
  if (booking?.id) await call("POST", `${s}/bookings/${booking.id}/cancel`, {}, { expected: [200, 409] });
  if (product?.id) await call("POST", `${s}/pass-products/${product.id}/archive`, undefined);
  if (subscription?.id) await call("DELETE", `${s}/me/push-subscriptions/${subscription.id}`, undefined, { expected: [204, 404] });
  const preferences = (await call("GET", `${s}/me/notification-preferences`)).json;
  await call(
    "PUT",
    `${s}/me/notification-preferences`,
    { groups: originalPreferences.groups, reminders: originalPreferences.reminders, quietHours: originalPreferences.quietHours },
    { ifMatch: preferences.version },
  );
  console.log("cleanup: the studio's words restored, booking cancelled, product archived, subscription deleted, preferences restored");
}

// 5. Nothing logged with the texts, the test address or the smoke user's email.
for (const group of ["/aws/lambda/tempo-dev-api", "/aws/lambda/tempo-dev-worker-outbox"]) {
  const needles = [["the texts", MARK], ["the smoke user's email", smokeEmail]];
  if (endpoint) needles.push(["the test address", endpoint.split("/").pop()]);
  for (const [label, needle] of needles) {
    const found = awsWithInput(["logs", "filter-log-events"], {
      logGroupName: group,
      startTime: started,
      filterPattern: `"${needle}"`,
    }).events?.length ?? 0;
    check(found === 0, `${group}: ${label} in no log line`);
  }
}

// 6. Neon usage.
const after = await neonUsage();
console.log(
  `Neon after: compute +${after.computeSeconds - before.computeSeconds} s, egress +${after.egressBytes - before.egressBytes} B, storage ${after.storageBytes - before.storageBytes >= 0 ? "+" : ""}${after.storageBytes - before.storageBytes} B`,
);

console.log(failures === 0 ? "all checks passed" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
