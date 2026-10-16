#!/usr/bin/env node
/**
 * A small booking load test on dev (day board #176, C6; B5 small of night board #136).
 *
 * Sized so it cannot dent the Neon Free quota: 20 fictional members book the same class in parallel, at most three
 * rounds of 20 requests (60 in total), plus the setup and cleanup calls. It reads the Neon project's usage before and
 * after and prints the difference.
 *
 *   round 1: 20 parallel bookings      → `capacity` booked, the rest waitlisted, no overbooking
 *   round 2: the same 20 again          → every one refused (already booked), counts unchanged
 *   round 3: 20 parallel cancellations  → the class is empty again and every entry is back
 *
 * A 503 is API Gateway throttling at the API function's reserved concurrency (10 on dev); it is reported per round
 * and never counted as a booking.
 *
 * Setup and cleanup: one temporary 10-entry card product, 20 people (`example.com` addresses, invented names) with
 * a card each; afterwards the people are erased and the product archived. The class is an existing scheduled one at
 * least two days ahead with nobody on it, so a cancellation is never late.
 *
 * Usage (from a developer's machine; `--profile tempo` needs cognito-idp:AdminInitiateAuth, ssm:GetParameter and
 * cloudformation:DescribeStacks, the same as the demo studio script):
 *   node tools/scripts/booking-load-test.mjs [--profile tempo] [--members 20] [--rounds 3]
 *
 * Never prints secret values.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = "eu-central-1";
const DEFAULT_API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const NEON_API = "https://console.neon.tech/api/v2";
// The dev project, as in infrastructure/config/development.ts.
const NEON_PROJECT_ID = "wild-darkness-22822656";
const PREFIX = "עומס: ";

function parseArgs(argv) {
  const args = { profile: "tempo", members: 20, rounds: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--members") args.members = Number(argv[++i]);
    else if (arg === "--rounds") args.rounds = Number(argv[++i]);
    else if (arg === "--api-url") args.apiUrl = argv[++i];
  }
  args.apiUrl ??= process.env.API_BASE_URL ?? DEFAULT_API;
  if (!(args.members >= 2 && args.members <= 20) || !(args.rounds >= 1 && args.rounds <= 3)) {
    console.error("✗ at most 20 members and 3 rounds: this test must not dent the Neon quota");
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", args.profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const ssm = (name) => JSON.parse(aws(["ssm", "get-parameter", "--name", name, "--with-decryption"])).Parameter.Value;

/** Signs in as the dev test user the way the live checks do; the password only touches a 0600 temp file. */
function signIn() {
  const outputs = JSON.parse(aws(["cloudformation", "describe-stacks", "--stack-name", "TempoDev-Identity"])).Stacks[0]
    .Outputs;
  const out = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;
  const path = out("SmokeTestParameterPath");
  const dir = mkdtempSync(join(tmpdir(), "tempo-load-"));
  try {
    const input = join(dir, "auth.json");
    writeFileSync(
      input,
      JSON.stringify({
        UserPoolId: out("UserPoolId"),
        ClientId: out("ClientWebClientId"),
        AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: ssm(`${path}/email`), PASSWORD: ssm(`${path}/password`) },
      }),
      { mode: 0o600 },
    );
    return JSON.parse(aws(["cognito-idp", "admin-initiate-auth", "--cli-input-json", `file://${input}`]))
      .AuthenticationResult.AccessToken;
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

const token = signIn();
let failures = 0;
let requests = 0;

async function call(method, route, body, expected = [200, 201, 204]) {
  requests += 1;
  const started = performance.now();
  const response = await fetch(`${args.apiUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const ms = performance.now() - started;
  if (!expected.includes(response.status)) {
    failures += 1;
    console.log(
      `✗ ${method} ${route.replace(/\/api\/v1\/organizations\/[0-9a-f-]+/, "{studio}")} → ${response.status} ${text.slice(0, 200)}`,
    );
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, ms };
}

const check = (ok, label) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};

const latency = (results) => {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const at = (q) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]);
  return `p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${Math.round(ms[ms.length - 1])} ms`;
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

const before = await neonUsage();
console.log(
  `Neon before: compute ${before.computeSeconds} s, egress ${before.egressBytes} B, storage ${before.storageBytes} B`,
);

await call("POST", "/api/v1/session");
const me = (await call("GET", "/api/v1/me")).json;
const membership = me.memberships.find((m) => m.permissions.includes("schedule.manage"));
if (!membership) {
  console.error("✗ the test user has no studio with schedule.manage");
  process.exit(1);
}
const s = `/api/v1/organizations/${membership.organization.id}`;

const earliest = new Date(Date.now() + 2 * 86_400_000).toISOString();
const session = (await call("GET", `${s}/sessions?from=${today()}&to=${addDays(today(), 30)}`)).json.items
  .filter((x) => x.status === "scheduled" && x.startsAt > earliest && x.bookedCount === 0 && x.waitlistCount === 0)
  .filter((x) => x.capacity >= 2 && x.capacity < args.members)
  .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
if (!session) {
  console.error(`✗ no empty scheduled class with fewer than ${args.members} places in the next 30 days`);
  process.exit(1);
}
console.log(`class: ${session.localDate}, capacity ${session.capacity}`);

const product = (
  await call("POST", `${s}/pass-products`, {
    kind: "punch_card",
    name: `${PREFIX}כרטיסייה`,
    entries: 10,
    validDays: 60,
    priceAgorot: 0,
  })
).json;
const people = [];
try {
  for (let i = 1; i <= args.members; i += 1) {
    const n = String(i).padStart(2, "0");
    const person = (
      await call("POST", `${s}/people`, { displayName: `${PREFIX}מתאמנת ${n}`, email: `load-${n}@example.com` })
    ).json;
    people.push(person.id);
    await call("POST", `${s}/people/${person.id}/passes`, { productId: product.id, note: "load test" });
  }
  const roster = async () => (await call("GET", `${s}/sessions/${session.id}`)).json;
  const book = (personId, expected) =>
    call("POST", `${s}/sessions/${session.id}/bookings`, { personId }, [...expected, 503]).then((r) => ({
      ...r,
      personId,
    }));
  // API Gateway answers 503 when the API function is at its reserved concurrency; that is a capacity result, not a
  // correctness one, so it is counted on its own and never hides an overbooking.
  const throttled = (results) => results.filter((r) => r.status === 503).length;
  const bookings = new Map();

  const round1 = await Promise.all(people.map((personId) => book(personId, [201])));
  for (const r of round1) if (r.status === 201) bookings.set(r.personId, r.json.id);
  const booked = round1.filter((r) => r.json?.status === "booked").length;
  const waiting = round1.filter((r) => r.json?.status === "waitlisted").length;
  const after1 = await roster();
  console.log(`round 1, ${round1.length} parallel bookings: ${latency(round1)}; ${throttled(round1)} throttled (503)`);
  check(booked <= session.capacity, `${booked} booked, ${waiting} waiting: no overbooking`);
  check(booked === Math.min(session.capacity, bookings.size), "every place is used before anyone waits");
  check(
    after1.bookedCount === booked && after1.waitlistCount === waiting,
    `the class agrees: ${after1.bookedCount}/${after1.capacity} booked, ${after1.waitlistCount} waiting`,
  );

  if (args.rounds >= 2) {
    // Everyone again: those with a place or a waitlist spot must be refused; a throttled one from round 1 may book now.
    const round2 = await Promise.all(people.map((personId) => book(personId, bookings.has(personId) ? [409] : [201])));
    const repeats = round2.filter((r) => bookings.has(r.personId) && r.status !== 503);
    for (const r of round2) if (r.status === 201) bookings.set(r.personId, r.json.id);
    const after2 = await roster();
    console.log(
      `round 2, ${round2.length} parallel repeat bookings: ${latency(round2)}; ${throttled(round2)} throttled (503)`,
    );
    check(
      repeats.every((r) => r.status === 409),
      `${repeats.length} repeat bookings, every one refused with 409`,
    );
    check(
      after2.bookedCount <= session.capacity && after2.bookedCount + after2.waitlistCount === bookings.size,
      `the class holds exactly the ${bookings.size} bookings made: ${after2.bookedCount} booked, ${after2.waitlistCount} waiting`,
    );
  }

  if (args.rounds >= 3) {
    const round3 = await Promise.all(
      [...bookings.values()].map((id) => call("POST", `${s}/bookings/${id}/cancel`, {}, [200, 503])),
    );
    console.log(
      `round 3, ${round3.length} parallel cancellations: ${latency(round3)}; ${throttled(round3)} throttled (503)`,
    );
  }
  // Whatever was throttled, nothing is left behind: erase does not cancel bookings (#191).
  for (const id of bookings.values()) await call("POST", `${s}/bookings/${id}/cancel`, {}, [200, 409]);
  const after3 = await roster();
  check(after3.bookedCount === 0 && after3.waitlistCount === 0, "the class is empty again");
  // One at a time: this read is the check, not part of the load.
  const passes = [];
  for (const id of people) passes.push(await call("GET", `${s}/people/${id}/passes`));
  const used = passes.flatMap((r) => r.json?.items ?? []).reduce((sum, p) => sum + (p.entriesUsed ?? 0), 0);
  check(used === 0, `every entry is back (${used} used)`);
} finally {
  for (const id of people) await call("POST", `${s}/people/${id}/erase`, { reason: "Load test cleanup" }, [200, 204]);
  if (product) await call("POST", `${s}/pass-products/${product.id}/archive`, undefined, [200, 204]);
  console.log(`cleanup: ${people.length} people erased, product archived`);
}

const after = await neonUsage();
console.log(
  `Neon after: compute +${after.computeSeconds - before.computeSeconds} s, egress +${after.egressBytes - before.egressBytes} B, storage ${after.storageBytes - before.storageBytes >= 0 ? "+" : ""}${after.storageBytes - before.storageBytes} B`,
);
console.log(`${requests} API requests in total, ${failures === 0 ? "all checks passed" : `${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);
