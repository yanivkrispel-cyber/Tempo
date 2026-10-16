#!/usr/bin/env node
/**
 * The notifications live check on dev (day board #176, P6; docs/30 sections 4.3 and 8).
 *
 * As the smoke user, in its studio:
 *   1. preferences: save own quiet hours and push on for every group, read them back (If-Match), put them back
 *   2. the VAPID public key route answers the key in SSM
 *   3. a test push subscription on an FCM address that no device holds (the RFC 8291 example keys)
 *   4. a reminder fired by hand: a two-entry, ten-day card for the smoke user (it ends first, so the booking uses
 *      it), one class booked inside those days, so one entry is left; one
 *      `notifications.reminders_hourly` message on the work queue, as the schedule sends it. The entries-low
 *      reminder reaches the inbox, and the delivery to the test address is answered by FCM (an unknown address is
 *      removed, as on a 404 or 410)
 *   5. the API and worker logs since the start hold neither the test address nor the smoke user's email
 *
 * Cleanup: the booking is cancelled (the entry comes back), the card product archived, the test subscription
 * deleted if FCM left it, the preferences restored. The card stays on the smoke user, used up by nothing.
 *
 * Usage (from a developer's machine; `--profile tempo` needs cognito-idp:AdminInitiateAuth, ssm:GetParameter,
 * cloudformation:DescribeStacks, sqs:GetQueueUrl, sqs:SendMessage and logs:FilterLogEvents):
 *   node tools/scripts/notifications-live-check.mjs [--profile tempo]
 *
 * Never prints secret values or the smoke user's address.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const PREFIX = "בדיקת התראות: ";
// RFC 8291 appendix A: published example keys, no real device.
const BROWSER_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const BROWSER_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

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
  const dir = mkdtempSync(join(tmpdir(), "tempo-notify-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(aws([...cliArgs, "--cli-input-json", `file://${file}`]) || "{}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    console.log(`✗ ${method} ${route.replace(/\/organizations\/[0-9a-f-]+/, "/{studio}")} → ${response.status} ${text.slice(0, 200)}`);
  }
  try {
    return { status: response.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, json: null };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

const me = (await call("GET", "/api/v1/me")).json;
const membership = me.memberships.find((m) => m.permissions.includes("schedule.manage"));
const s = `/api/v1/organizations/${membership.organization.id}`;
const person = (await call("GET", `${s}/people?query=${encodeURIComponent(smokeEmail)}`)).json.items[0];

// 1. Preferences and quiet hours.
const original = (await call("GET", `${s}/me/notification-preferences`)).json;
const choice = {
  groups: original.groups.map((g) => ({ group: g.group, channels: { inbox: true, push: true } })),
  reminders: { ...original.reminders, entriesLow: true },
  quietHours: { startsLocal: "03:00", endsLocal: "04:00" },
};
await call("PUT", `${s}/me/notification-preferences`, choice, { ifMatch: original.version });
const saved = (await call("GET", `${s}/me/notification-preferences`)).json;
check(
  saved.quietHours?.startsLocal === "03:00" && saved.groups.every((g) => g.channels.push),
  "preferences: own quiet hours 03:00-04:00 and push on, read back",
);
check(
  (await call("PUT", `${s}/me/notification-preferences`, choice, { ifMatch: original.version, expected: [409] })).status === 409,
  "preferences: a save with the old version is refused (409)",
);

// 2. The VAPID public key.
const key = (await call("GET", "/api/v1/push/vapid-public-key")).json;
check(key?.publicKey === ssm("/tempo/dev/push/vapid-public-key"), "the key route answers the public key in SSM");

// 3. A test subscription on an address no device holds.
const endpoint = `https://fcm.googleapis.com/fcm/send/tempo-live-check-${randomUUID()}`;
const subscription = (
  await call("POST", `${s}/me/push-subscriptions`, {
    endpoint,
    keys: { p256dh: BROWSER_KEY, auth: BROWSER_AUTH },
    deviceLabel: "Live check",
  })
).json;
check(Boolean(subscription?.id), "a test push subscription is saved");

// 4. A reminder fired by hand.
const product = (
  await call("POST", `${s}/pass-products`, { kind: "punch_card", name: `${PREFIX}כרטיסייה`, entries: 2, validDays: 10, priceAgorot: 0 })
).json;
let booking;
try {
  await call("POST", `${s}/people/${person.id}/passes`, { productId: product.id, note: "notifications live check" });
  const earliest = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const session = (await call("GET", `${s}/sessions?from=${today()}&to=${addDays(today(), 30)}`)).json.items
    .filter((x) => x.status === "scheduled" && x.startsAt > earliest && x.localDate < addDays(today(), 9) && x.bookedCount < x.capacity)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  booking = (await call("POST", `${s}/sessions/${session.id}/bookings`, { personId: person.id })).json;

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
    reminder = (await call("GET", `${s}/me/notifications`)).json?.items?.find(
      (item) => item.kind === "reminder.entries_low" && Date.parse(item.createdAt) >= started,
    );
  }
  check(Boolean(reminder), "the entries-low reminder reached the inbox");

  await sleep(10000);
  const left = (await call("GET", `${s}/me/push-subscriptions`)).json?.items;
  const kept = left?.some((x) => x.id === subscription?.id);
  console.log(`push: the test subscription is ${left === undefined ? "unknown (list failed)" : kept ? "still there (FCM did not answer 404/410)" : "removed (FCM answered it gone)"}`);
} finally {
  if (booking?.id) await call("POST", `${s}/bookings/${booking.id}/cancel`, {}, { expected: [200, 409] });
  if (product?.id) await call("POST", `${s}/pass-products/${product.id}/archive`, undefined);
  if (subscription?.id) await call("DELETE", `${s}/me/push-subscriptions/${subscription.id}`, undefined, { expected: [204, 404] });
  const current = (await call("GET", `${s}/me/notification-preferences`)).json;
  await call(
    "PUT",
    `${s}/me/notification-preferences`,
    { groups: original.groups, reminders: original.reminders, quietHours: original.quietHours },
    { ifMatch: current.version },
  );
  console.log("cleanup: booking cancelled, product archived, subscription deleted, preferences restored");
}

// 5. Nothing logged with the test address or the smoke user's email.
for (const group of ["/aws/lambda/tempo-dev-api", "/aws/lambda/tempo-dev-worker-outbox"]) {
  for (const [label, needle] of [["the test address", endpoint.split("/").pop()], ["the smoke user's email", smokeEmail]]) {
    const found = awsWithInput(["logs", "filter-log-events"], {
      logGroupName: group,
      startTime: started,
      filterPattern: `"${needle}"`,
    }).events?.length ?? 0;
    check(found === 0, `${group}: ${label} is in no log line`);
  }
}

console.log(failures === 0 ? "all checks passed" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
