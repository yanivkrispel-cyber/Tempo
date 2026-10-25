#!/usr/bin/env node
/**
 * Demo studio on dev (night board #136, B1).
 *
 * Fills the dev test user's fixture studio with a Hebrew demo: two rooms, four class types, eight weekly classes
 * (the API materializes eight weeks of sessions), three pass products, twelve fictional members with passes, and
 * bookings that leave one class full with a waitlist. Everything is fictional (`example.com` addresses, invented
 * names); the repo is public. One command removes it all.
 *
 * Usage (from a developer's machine; needs `--profile tempo` rights for cognito-idp:AdminInitiateAuth,
 * ssm:GetParameter and cloudformation:DescribeStacks, the same as the live checks):
 *   node tools/scripts/demo-studio.mjs seed   [--profile tempo] [--manifest <file>] [--force]
 *   node tools/scripts/demo-studio.mjs clean  [--profile tempo] [--manifest <file>]
 *   node tools/scripts/demo-studio.mjs fill   [--email <owner> --studio <slug>] [--days 7]
 *   node tools/scripts/demo-studio.mjs unfill [--email <owner> --studio <slug>]
 *
 * `fill` (board #494, K3; docs/runbooks/studio-demo.md) makes the coming days of an existing demo studio look lived
 * in: fictional people (`@example.com` only) who hold an active pass are booked into upcoming classes that are still
 * empty; the smallest class fills with two waiting. It keeps the booking ids in <tmpdir>/tempo-demo-fill-<studio>.json,
 * and `unfill` cancels exactly those, with their entries returned. By default both act as the dev test user; with
 * `--email` they sign in as that studio owner instead, with the password from TEMPO_DEMO_PASSWORD (never printed or
 * stored), and `--studio` picks the studio by its slug.
 *
 * `seed` writes a manifest (default: <tmpdir>/tempo-demo-studio.json) with every id it created; `clean` reads it,
 * cancels the demo sessions (entries return, waiters are removed), ends the weekly classes, archives the products,
 * rooms and class types, and erases the members. Without a manifest, `clean` finds the demo by its name prefix.
 * Never prints secret values.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isFictional, planFill } from "./lib/demo-fill.mjs";
import { demoMemberEmail, isDemoMember } from "./lib/demo-members.mjs";

const PREFIX = "דמו: ";
const REGION = "eu-central-1";
const DEFAULT_API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";

function parseArgs(argv) {
  const args = { command: argv[0], profile: "tempo", manifest: join(tmpdir(), "tempo-demo-studio.json"), force: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--manifest") args.manifest = argv[++i];
    else if (arg === "--api-url") args.apiUrl = argv[++i];
    else if (arg === "--force") args.force = true;
    else if (arg === "--email") args.email = argv[++i];
    else if (arg === "--studio") args.studio = argv[++i];
    else if (arg === "--days") args.days = Number(argv[++i]);
  }
  args.apiUrl ??= process.env.API_BASE_URL ?? DEFAULT_API;
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!["seed", "clean", "fill", "unfill"].includes(args.command)) {
  console.error(
    "usage: demo-studio.mjs <seed|clean|fill|unfill> [--profile tempo] [--manifest <file>] [--force] [--email <owner> --studio <slug>] [--days 7]",
  );
  process.exit(2);
}
if (args.email && !process.env.TEMPO_DEMO_PASSWORD) {
  console.error("✗ --email needs the owner's password in TEMPO_DEMO_PASSWORD");
  process.exit(2);
}
if (args.email && ["seed", "clean"].includes(args.command)) {
  console.error("✗ seed and clean act on the dev test user's studio only; --email is for fill and unfill");
  process.exit(2);
}

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", args.profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** Signs in as the dev test user the way the live checks do; the password only touches a 0600 temp file. */
function signIn() {
  const outputs = JSON.parse(aws(["cloudformation", "describe-stacks", "--stack-name", "TempoDev-Identity"])).Stacks[0]
    .Outputs;
  const out = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;
  const path = out("SmokeTestParameterPath");
  const ssm = (name) => JSON.parse(aws(["ssm", "get-parameter", "--name", name, "--with-decryption"])).Parameter.Value;
  const dir = mkdtempSync(join(tmpdir(), "tempo-demo-"));
  try {
    const input = join(dir, "auth.json");
    writeFileSync(
      input,
      JSON.stringify({
        UserPoolId: out("UserPoolId"),
        ClientId: out("ClientWebClientId"),
        AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
        AuthParameters: args.email
          ? { USERNAME: args.email, PASSWORD: process.env.TEMPO_DEMO_PASSWORD }
          : { USERNAME: ssm(`${path}/email`), PASSWORD: ssm(`${path}/password`) },
      }),
      { mode: 0o600 },
    );
    return JSON.parse(aws(["cognito-idp", "admin-initiate-auth", "--cli-input-json", `file://${input}`]))
      .AuthenticationResult.AccessToken;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const token = signIn();
let failures = 0;

async function call(method, route, body, expected = [200, 201, 204]) {
  const response = await fetch(`${args.apiUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const ok = expected.includes(response.status);
  if (!ok) {
    failures += 1;
    console.log(
      `✗ ${method} ${route.replace(/\/api\/v1\/organizations\/[0-9a-f-]+/, "{studio}")} → ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

await call("POST", "/api/v1/session");
const me = await call("GET", "/api/v1/me");
const membership = me.memberships.find(
  (m) => m.permissions.includes("schedule.manage") && (!args.studio || m.organization.slug === args.studio),
);
if (!membership) {
  console.error(`✗ the signed-in user has no studio${args.studio ? ` "${args.studio}"` : ""} with schedule.manage`);
  process.exit(1);
}
const s = `/api/v1/organizations/${membership.organization.id}`;
console.log(`studio: ${membership.organization.displayName ?? membership.organization.id}`);

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------------------------------------------

const ROOMS = [
  { name: "אולם ראשי", defaultCapacity: 12 },
  { name: "חדר רפורמר", defaultCapacity: 4 },
];

const CLASS_TYPES = [
  {
    key: "mat",
    name: "פילאטיס מזרן",
    category: "pilates",
    color: "sage",
    defaultMinutes: 55,
    description: "שיעור מזרן לכל הרמות. מגיעים עם מגבת ומים.",
  },
  {
    key: "reformer",
    name: "רפורמר",
    category: "pilates",
    color: "rose",
    defaultMinutes: 50,
    description: "קבוצה קטנה על מכשירי רפורמר. עד ארבעה משתתפים.",
  },
  {
    key: "yoga",
    name: "יוגה ויניאסה",
    category: "yoga",
    color: "blue",
    defaultMinutes: 60,
    description: "זרימה שמחברת נשימה ותנועה. מתאים גם למתחילים.",
  },
  {
    key: "strength",
    name: "כוח ותנועה",
    category: "strength",
    color: "amber",
    defaultMinutes: 45,
    description: "אימון כוח פונקציונלי עם משקל גוף ומשקולות קלות.",
  },
];

// 0 = Sunday, as the API counts (docs/29 section 7).
const TEMPLATES = [
  { type: "mat", weekday: 0, localStart: "07:00", room: "אולם ראשי", capacity: 12 },
  { type: "reformer", weekday: 0, localStart: "18:30", room: "חדר רפורמר", capacity: 4 },
  { type: "yoga", weekday: 1, localStart: "08:00", room: "אולם ראשי", capacity: 12 },
  { type: "strength", weekday: 1, localStart: "19:00", room: "אולם ראשי", capacity: 10 },
  { type: "reformer", weekday: 2, localStart: "07:00", room: "חדר רפורמר", capacity: 4 },
  { type: "mat", weekday: 3, localStart: "18:00", room: "אולם ראשי", capacity: 12 },
  { type: "yoga", weekday: 4, localStart: "08:00", room: "אולם ראשי", capacity: 12 },
  { type: "strength", weekday: 5, localStart: "08:30", room: "אולם ראשי", capacity: 10 },
];

const PRODUCTS = [
  { key: "card10", kind: "punch_card", name: "כרטיסייה 10 כניסות", entries: 10, validDays: 90, priceAgorot: 60_000 },
  { key: "card5", kind: "punch_card", name: "כרטיסייה 5 כניסות", entries: 5, validDays: 60, priceAgorot: 35_000 },
  { key: "monthly", kind: "membership", name: "מנוי חודשי, 3 בשבוע", validDays: 30, weeklyCap: 3, priceAgorot: 45_000 },
];

// Invented names; the addresses are reserved for examples (RFC 2606). Not real people.
const MEMBERS = [
  { displayName: "נועה ברק", product: "card10" },
  { displayName: "יובל שחר", product: "card10" },
  { displayName: "מאיה לוין", product: "card10" },
  { displayName: "איתי רוזן", product: "card10" },
  { displayName: "תמר אלון", product: "card10" },
  { displayName: "עומר כץ", product: "card5" },
  { displayName: "שירה מור", product: "card5" },
  { displayName: "דניאל פרץ", product: "card5" },
  { displayName: "ליאור גל", product: "card5" },
  { displayName: "רוני אביב", product: "monthly" },
  { displayName: "הדס נחום", product: "monthly" },
  { displayName: "אורי ים", product: "monthly" },
];

async function seed() {
  if (existsSync(args.manifest) && !args.force) {
    console.error(`✗ a manifest already exists at ${args.manifest}; run "clean" first, or pass --force`);
    process.exit(1);
  }
  const manifest = {
    studioId: membership.organization.id,
    createdAt: new Date().toISOString(),
    rooms: [],
    classTypes: [],
    templates: [],
    products: [],
    people: [],
  };
  const save = () => writeFileSync(args.manifest, JSON.stringify(manifest, null, 2));

  const rooms = {};
  for (const room of ROOMS) {
    const created = await call("POST", `${s}/rooms`, { ...room, name: PREFIX + room.name });
    rooms[room.name] = created.id;
    manifest.rooms.push(created.id);
    save();
  }
  const types = {};
  for (const { key, ...type } of CLASS_TYPES) {
    const created = await call("POST", `${s}/class-types`, { ...type, name: PREFIX + type.name });
    types[key] = created.id;
    manifest.classTypes.push(created.id);
    save();
  }
  console.log(`✓ ${ROOMS.length} rooms, ${CLASS_TYPES.length} class types`);

  for (const t of TEMPLATES) {
    const created = await call("POST", `${s}/schedule-templates`, {
      classTypeId: types[t.type],
      weekday: t.weekday,
      localStart: t.localStart,
      roomId: rooms[t.room],
      capacity: t.capacity,
    });
    // A template change answers with the template and the sessions it could not touch.
    manifest.templates.push({ id: created.template.id, classTypeId: types[t.type] });
    save();
  }
  const sessions = (await call("GET", `${s}/sessions?from=${today()}&to=${addDays(today(), 61)}`)).items.filter((x) =>
    manifest.templates.some((t) => t.id === x.templateId),
  );
  console.log(`✓ ${TEMPLATES.length} weekly classes, ${sessions.length} sessions materialized`);

  const products = {};
  for (const { key, ...product } of PRODUCTS) {
    const created = await call("POST", `${s}/pass-products`, { ...product, name: PREFIX + product.name });
    products[key] = created.id;
    manifest.products.push(created.id);
    save();
  }

  const people = [];
  for (const [index, member] of MEMBERS.entries()) {
    const person = await call("POST", `${s}/people`, {
      displayName: member.displayName,
      email: demoMemberEmail(index),
    });
    manifest.people.push(person.id);
    save();
    await call("POST", `${s}/people/${person.id}/passes`, { productId: products[member.product], note: "דמו" });
    people.push(person.id);
  }
  console.log(`✓ ${PRODUCTS.length} pass products, ${MEMBERS.length} members with passes`);

  // Bookings: the next reformer class fills (4 places, 6 bookings → 2 waiting); a mat class and a yoga class get a few.
  const now = new Date().toISOString();
  const upcoming = sessions
    .filter((x) => x.status === "scheduled" && x.startsAt > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const next = (key) => upcoming.find((x) => x.classType.id === types[key]);
  const plan = [
    [next("reformer"), people.slice(0, 6)],
    [next("mat"), people.slice(6, 11)],
    [next("yoga"), [people[11], people[0], people[5]]],
  ];
  let booked = 0;
  let waiting = 0;
  for (const [session, ids] of plan) {
    if (!session) continue;
    for (const personId of ids) {
      const booking = await call("POST", `${s}/sessions/${session.id}/bookings`, { personId }, [201]);
      if (booking?.status === "booked") booked += 1;
      if (booking?.status === "waitlisted") waiting += 1;
    }
  }
  console.log(`✓ ${booked} bookings, ${waiting} on a waitlist`);
  console.log(`manifest: ${args.manifest}`);
}

// ---------------------------------------------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------------------------------------------

async function discover() {
  const byPrefix = (items) =>
    items.filter((x) => x.name?.startsWith(PREFIX) && x.status !== "archived").map((x) => x.id);
  const manifest = {
    studioId: membership.organization.id,
    rooms: [],
    classTypes: [],
    templates: [],
    products: [],
    people: [],
  };
  manifest.rooms = byPrefix((await call("GET", `${s}/rooms`)).items);
  manifest.classTypes = byPrefix((await call("GET", `${s}/class-types`)).items);
  manifest.templates = (await call("GET", `${s}/schedule-templates`)).items
    .filter((t) => manifest.classTypes.includes(t.classTypeId) && !t.validUntil)
    .map((t) => ({ id: t.id, classTypeId: t.classTypeId }));
  manifest.products = byPrefix((await call("GET", `${s}/pass-products`)).items);
  const people = (await call("GET", `${s}/people?limit=100`)).items;
  manifest.people = people.filter((p) => isDemoMember(p, MEMBERS)).map((p) => p.id);
  return manifest;
}

async function clean() {
  const manifest = existsSync(args.manifest) ? JSON.parse(readFileSync(args.manifest, "utf8")) : await discover();
  if (manifest.studioId !== membership.organization.id) {
    console.error("✗ the manifest belongs to another studio");
    process.exit(1);
  }

  // Sessions first: cancelling returns every entry and removes the waiters.
  const sessions = (await call("GET", `${s}/sessions?from=${today()}&to=${addDays(today(), 61)}`)).items.filter(
    (x) => manifest.templates.some((t) => t.id === x.templateId) && x.status !== "cancelled",
  );
  for (const session of sessions) await call("POST", `${s}/sessions/${session.id}/cancel`, undefined, [200, 409]);
  console.log(`✓ ${sessions.length} sessions cancelled`);

  for (const t of manifest.templates) await call("PATCH", `${s}/schedule-templates/${t.id}`, { validUntil: today() });
  for (const id of manifest.products)
    await call("POST", `${s}/pass-products/${id}/archive`, undefined, [200, 204, 409]);
  for (const id of manifest.rooms) await call("PATCH", `${s}/rooms/${id}`, { status: "archived" });
  for (const id of manifest.classTypes) await call("PATCH", `${s}/class-types/${id}`, { status: "archived" });
  console.log(
    `✓ ${manifest.templates.length} weekly classes ended, ${manifest.products.length} products, ${manifest.rooms.length} rooms and ${manifest.classTypes.length} class types archived`,
  );

  for (const id of manifest.people)
    await call("POST", `${s}/people/${id}/erase`, { reason: "Demo studio cleanup" }, [200, 204, 404]);
  console.log(`✓ ${manifest.people.length} members erased`);

  if (existsSync(args.manifest)) unlinkSync(args.manifest);
}

// ---------------------------------------------------------------------------------------------------------------
// fill and unfill (board #494, K3)
// ---------------------------------------------------------------------------------------------------------------

const fillManifest = join(tmpdir(), `tempo-demo-fill-${membership.organization.id}.json`);

async function fill() {
  const days = Number.isInteger(args.days) && args.days > 0 ? args.days : 7;
  const sessions = (await call("GET", `${s}/sessions?from=${today()}&to=${addDays(today(), days)}`)).items;
  // The people list has no cursor and caps at 100 (fine for a demo studio); in a bigger one `fill` sees only the
  // fictional people on the first page.
  const fictional = (await call("GET", `${s}/people?limit=100`)).items.filter(isFictional);
  const holders = [];
  for (const person of fictional) {
    const passes = (await call("GET", `${s}/people/${person.id}/passes`))?.items ?? [];
    if (passes.some((p) => p.status === "active" && (p.entriesLeft === null || p.entriesLeft > 0))) holders.push(person.id);
  }
  console.log(`✓ ${fictional.length} fictional people, ${holders.length} with an active pass`);

  const done = existsSync(fillManifest) ? JSON.parse(readFileSync(fillManifest, "utf8")) : { bookings: [] };
  let booked = 0;
  let waiting = 0;
  for (const { sessionId, personIds } of planFill(sessions, holders, new Date().toISOString())) {
    for (const personId of personIds) {
      // 409: the person can't book this one (no entry left, already booked, booking closed); the plan moves on.
      const booking = await call("POST", `${s}/sessions/${sessionId}/bookings`, { personId }, [201, 409]);
      if (!booking?.id) continue;
      done.bookings.push(booking.id);
      writeFileSync(fillManifest, JSON.stringify(done, null, 2));
      if (booking.status === "booked") booked += 1;
      if (booking.status === "waitlisted") waiting += 1;
    }
  }
  console.log(`✓ ${booked} bookings, ${waiting} on a waitlist (in the next ${days} days)`);
  console.log(`fill manifest: ${fillManifest}`);
}

async function unfill() {
  if (!existsSync(fillManifest)) {
    console.log("nothing to undo: no fill manifest for this studio");
    return;
  }
  const { bookings } = JSON.parse(readFileSync(fillManifest, "utf8"));
  let cancelled = 0;
  for (const id of bookings) {
    // 404 or 409: the booking is gone already (the class passed, or someone cancelled it); nothing to undo.
    const booking = await call("POST", `${s}/bookings/${id}/cancel`, { returnEntry: true }, [200, 404, 409]);
    if (booking?.id) cancelled += 1;
  }
  console.log(`✓ ${cancelled} of ${bookings.length} demo bookings cancelled, entries returned`);
  unlinkSync(fillManifest);
}

if (args.command === "seed") await seed();
else if (args.command === "clean") await clean();
else if (args.command === "fill") await fill();
else await unfill();

console.log(
  failures === 0
    ? `\nDEMO ${args.command.toUpperCase()} DONE`
    : `\nDEMO ${args.command.toUpperCase()} FINISHED WITH ${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
