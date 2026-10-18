#!/usr/bin/env node
/**
 * Dresses a dev demo studio for the Warm Glass screens (board #347, K5; docs/33): what the premium mockups show,
 * on top of the studio the demo seed already filled (rooms, class types, weekly classes, passes, people).
 *
 *   1. room maps: the first room 2 x 4 spots with the mirror at the front and the window on the right, the second
 *      3 x 4
 *   2. two fictional coaches (Cognito users `demo-coach-<slug>-<n>@example.com`, invited as staff) and the owner,
 *      each with a profile: headline, bio, a clearly fake Instagram handle and playlist, and a photo
 *   3. the weekly classes shared between the three instructors
 *   4. a cover for every class type and for the studio
 *   5. the instructor's note on the next four classes
 *   6. a buddy pair: the studio's test member and a fictional member (`demo-buddy-<slug>@example.com`), booked side
 *      by side in the next class with free spots next to each other
 *   7. passes sold this month, so the owner's sales have numbers
 *   8. a class starting in 20 minutes with five demo people marked attended and the buddy checked in with their
 *      code at the door, so the live map and the activity feed have arrivals
 *
 * Photos come from Unsplash (its license allows this use) and are downloaded while the script runs; none is in the
 * repo. People are fictional (example.com); the coaches' Instagram handles and playlists say "example".
 *
 * Usage (from a developer's machine; the test users' password is in TEMPO_DEMO_PASSWORD, never on the command line
 * or in the repo; `--profile tempo` needs Cognito admin user calls and cloudformation:DescribeStacks):
 *   TEMPO_DEMO_PASSWORD=... node tools/scripts/demo-premium.mjs <studio-slug> --owner <email> --member <email> [--profile tempo]
 *
 * Running it again updates the same rooms, profiles and covers; it adds another set of sales and arrivals.
 * Never prints passwords, tokens, presigned URLs or anyone's address.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uploadFormData } from "./lib/premium-live.mjs";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const TZ = "Asia/Jerusalem";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const slug = argv[0];
const ownerEmail = option("--owner");
const memberEmail = option("--member");
const profile = option("--profile", "tempo");
const password = process.env.TEMPO_DEMO_PASSWORD;
if (!slug || slug.startsWith("--") || !ownerEmail || !memberEmail || !password) {
  console.error("usage: TEMPO_DEMO_PASSWORD=... node tools/scripts/demo-premium.mjs <studio-slug> --owner <email> --member <email> [--profile tempo]");
  process.exit(2);
}

/** Unsplash photos (images.unsplash.com ids), checked on 2026-10-18. */
const PHOTOS = {
  studio: "1783841193384-4269c68aa050",
  reformer: "1788463127138-d17920230de9",
  pilates: "1754257320374-cd5fb647cfea",
  yoga: "1787647089633-37e49ee2e054",
  mat: "1761035005546-62b8018b212a",
  stretch: "1763403921315-f2ef8697199f",
  coaches: ["1683848644087-c3cb69b77d4f", "1758875568932-0eefd3e60090", "1692197174597-1d85555c9b33"],
};

const COACHES = [
  { name: "שירה אלון", headline: "מורה לפילאטיס מכשירים", bio: "עשר שנים על הרפורמר. אוהבת שיעורים איטיים ומדויקים, עם הרבה תשומת לב לנשימה.", handle: "example.shira", playlist: "https://open.spotify.com/playlist/example-shira" },
  { name: "איתי ברק", headline: "יוגה ומוביליטי", bio: "מלמד ויניאסה ויוגה עדינה. השיעורים שלי נגמרים תמיד בעשר דקות של שקט.", handle: "example.itai", playlist: "https://music.apple.com/il/playlist/example-itai" },
];
const OWNER_PROFILE = { headline: "מייסדת הסטודיו", bio: "פתחתי את הסטודיו כדי שיהיה מקום שקט לזוז בו. מלמדת פילאטיס מזרן ומכשירים.", handle: "example.studio", playlist: "https://open.spotify.com/playlist/example-studio" };
const NOTES = ["להביא גרביים נגד החלקה", "היום עובדים על יציבה, שיעור רגוע", "מוזיקה חדשה בשיעור, ספרו לי מה דעתכם", "מים וחולצה ארוכה, המזגן חזק היום"];

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });

/** Runs `aws <args> --cli-input-json` from a private temporary file, so no value lands on a command line. */
function awsWithInput(cliArgs, input) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-dress-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(aws([...cliArgs, "--cli-input-json", `file://${file}`]) || "{}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const outputs = JSON.parse(aws(["cloudformation", "describe-stacks", "--stack-name", "TempoDev-Identity"])).Stacks[0].Outputs;
const out = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;
const poolId = out("UserPoolId");
const clientId = out("ClientWebClientId");

const signIn = (username, secret) =>
  awsWithInput(["cognito-idp", "admin-initiate-auth"], {
    UserPoolId: poolId,
    ClientId: clientId,
    AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD: secret },
  }).AuthenticationResult.AccessToken;

let failures = 0;
const done = (label) => console.log(`✓ ${label}`);

async function call(token, method, route, body, { expected = [200, 201, 202, 204], ifMatch } = {}) {
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
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the status says enough.
  }
  if (!expected.includes(response.status)) {
    failures += 1;
    console.log(`✗ ${method} ${route.replace(/\/organizations\/[0-9a-f-]+/, "/{studio}")} → ${response.status} ${(json?.code ?? text).toString().slice(0, 160)}`);
  }
  return { status: response.status, json };
}

/** A fictional login for this demo: created once, given a fresh random password each run, signed in. */
function fictionalUser(email) {
  try {
    awsWithInput(["cognito-idp", "admin-create-user"], {
      UserPoolId: poolId,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
      ],
      MessageAction: "SUPPRESS",
    });
  } catch (error) {
    if (!String(error.stderr ?? error.message).includes("UsernameExistsException")) throw error;
  }
  const secret = `${randomBytes(12).toString("base64url")}aA1!`;
  awsWithInput(["cognito-idp", "admin-set-user-password"], { UserPoolId: poolId, Username: email, Password: secret, Permanent: true });
  return signIn(email, secret);
}

const photoCache = new Map();
async function photo(id, width) {
  const key = `${id}@${width}`;
  if (!photoCache.has(key)) {
    const response = await fetch(`https://images.unsplash.com/photo-${id}?w=${width}&fm=jpg&q=80`);
    if (!response.ok) throw new Error(`Unsplash photo ${id} → ${response.status}`);
    photoCache.set(key, Buffer.from(await response.arrayBuffer()));
  }
  return photoCache.get(key);
}

/** Ticket, upload (the presigned POST when the API offers it, else the older PUT), finalize. */
async function upload(token, s, purpose, ownerId, photoId, width) {
  const bytes = await photo(photoId, width);
  const ticket = (await call(token, "POST", `${s}/media/uploads`, { purpose, ownerId, contentType: "image/jpeg", bytes: bytes.length })).json;
  if (!ticket) return null;
  const sent = ticket.uploadForm
    ? await fetch(ticket.uploadForm.url, { method: "POST", body: uploadFormData(ticket.uploadForm.fields, bytes, "image/jpeg") })
    : await fetch(ticket.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: bytes });
  if (!sent.ok) {
    failures += 1;
    console.log(`✗ the ${purpose} upload to S3 → ${sent.status}`);
    return null;
  }
  return (await call(token, "POST", `${s}/media/uploads/${ticket.mediaId}/finalize`)).json;
}

function localParts(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// ---------------------------------------------------------------------------------------------------------------

const owner = signIn(ownerEmail, password);
const me = (await call(owner, "GET", "/api/v1/me")).json;
const membership = me.memberships.find((m) => m.organization.slug === slug);
if (!membership || !membership.permissions.includes("schedule.manage")) {
  console.error(`✗ the owner account does not manage ${slug}`);
  process.exit(1);
}
const s = `/api/v1/organizations/${membership.organization.id}`;
const ownerMembershipId = membership.membershipId ?? membership.id;

// 1. Room maps.
const rooms = (await call(owner, "GET", `${s}/rooms`)).json.items.filter((r) => r.status === "active");
const shapes = [
  { rows: 2, cols: 4, windowSide: "start", mirrorFront: true },
  { rows: 3, cols: 4, windowSide: "back", mirrorFront: true },
];
for (const [index, room] of rooms.slice(0, 2).entries()) {
  const shape = shapes[index];
  const layout = (await call(owner, "GET", `${s}/rooms/${room.id}/layout`)).json;
  const spots = [];
  for (let row = 0; row < shape.rows; row++) {
    for (let col = 0; col < shape.cols; col++) {
      const label = String(row * shape.cols + col + 1);
      spots.push({ id: layout.spots.find((old) => old.label === label)?.id, label, row, col });
    }
  }
  const saved = await call(owner, "PUT", `${s}/rooms/${room.id}/layout`, { spotSelection: true, ...shape, spots }, { ifMatch: layout.version });
  if (saved.status === 200) done(`room ${index + 1}: ${shape.rows} x ${shape.cols} spots, spot selection on`);
}

// 2. Coaches and profiles.
const members = (await call(owner, "GET", `${s}/members`)).json.items;
const instructors = [{ membershipId: ownerMembershipId, token: owner, profile: OWNER_PROFILE }];
for (const [index, coach] of COACHES.entries()) {
  const email = `demo-coach-${slug}-${index + 1}@example.com`;
  const token = fictionalUser(email);
  await call(token, "POST", "/api/v1/session");
  await call(token, "PATCH", "/api/v1/me", { displayName: coach.name });
  let membershipId = members.find((m) => m.email.toLowerCase() === email)?.id;
  if (!membershipId) {
    const invitation = (await call(owner, "POST", `${s}/invitations`, { email, role: "staff" })).json;
    membershipId = (await call(token, "POST", "/api/v1/invitations/accept", { token: new URL(invitation.link).hash.slice(1) })).json?.membershipId;
  }
  instructors.push({ membershipId, token, profile: coach });
}
for (const [index, instructor] of instructors.entries()) {
  const { headline, bio, handle, playlist } = instructor.profile;
  await call(instructor.token, "PUT", `${s}/me/staff-profile`, { headline, bio, instagramHandle: handle, playlistUrl: playlist, visible: true });
  await upload(owner, s, "instructor_photo", instructor.membershipId, PHOTOS.coaches[index], 900);
}
done(`${instructors.length} instructor profiles with photos (the owner and ${COACHES.length} fictional coaches)`);

// 3. The weekly classes shared between the instructors.
const templates = (await call(owner, "GET", `${s}/schedule-templates`)).json.items.filter((t) => !t.validUntil);
for (const [index, template] of templates.entries()) {
  const instructor = instructors[index % instructors.length];
  if (template.instructorMembershipId !== instructor.membershipId) {
    await call(owner, "PATCH", `${s}/schedule-templates/${template.id}`, { instructorMembershipId: instructor.membershipId }, { ifMatch: template.version });
  }
}
done(`${templates.length} weekly classes shared between the instructors`);

// 4. Covers.
const classTypes = (await call(owner, "GET", `${s}/class-types`)).json.items.filter((t) => t.status === "active");
const coverFor = (type) => {
  const name = `${type.name} ${type.category}`.toLowerCase();
  if (/מכשיר|reformer/.test(name)) return PHOTOS.reformer;
  if (/יוגה|yoga/.test(name)) return PHOTOS.yoga;
  if (/מתיחות|stretch|mobility|מוביליטי/.test(name)) return PHOTOS.stretch;
  if (/פילאטיס|pilates/.test(name)) return PHOTOS.pilates;
  return PHOTOS.mat;
};
for (const type of classTypes) await upload(owner, s, "class_cover", type.id, coverFor(type), 1600);
await upload(owner, s, "studio_cover", membership.organization.id, PHOTOS.studio, 1600);
done(`${classTypes.length} class covers and the studio cover`);

// 5. Notes on the next classes.
const now = new Date();
const from = localParts(now).date;
const to = localParts(new Date(now.getTime() + 7 * 86_400_000)).date;
const upcoming = (await call(owner, "GET", `${s}/sessions?from=${from}&to=${to}`)).json.items
  .filter((x) => x.status === "scheduled" && Date.parse(x.startsAt) > now.getTime() + 60 * 60_000)
  .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
for (const [index, session] of upcoming.slice(0, 4).entries()) {
  await call(owner, "PUT", `${s}/sessions/${session.id}/member-note`, { note: NOTES[index] });
}
done(`instructor's notes on the next ${Math.min(4, upcoming.length)} classes`);

// 6. A buddy pair, side by side.
const member = signIn(memberEmail, password);
const buddyEmail = `demo-buddy-${slug}@example.com`;
const buddy = fictionalUser(buddyEmail);
await call(buddy, "POST", "/api/v1/session");
await call(buddy, "PATCH", "/api/v1/me", { displayName: "טל שקד" });
let buddyPerson = members.find((m) => m.email.toLowerCase() === buddyEmail)?.personId;
if (!buddyPerson) {
  const invitation = (await call(owner, "POST", `${s}/invitations`, { email: buddyEmail, role: "client" })).json;
  await call(buddy, "POST", "/api/v1/invitations/accept", { token: new URL(invitation.link).hash.slice(1) });
  buddyPerson = (await call(owner, "GET", `${s}/people?query=${encodeURIComponent(buddyEmail)}`)).json.items[0]?.id;
}
const memberPerson = (await call(member, "GET", `${s}/me/profile`)).json?.id;
const already = (await call(member, "GET", `${s}/me/buddies`)).json?.items ?? [];
if (!already.some((b) => b.personId === buddyPerson)) {
  const code = (await call(buddy, "POST", `${s}/me/buddy-code`)).json?.code;
  await call(member, "POST", `${s}/me/buddies`, { code });
}
const products = (await call(owner, "GET", `${s}/pass-products`)).json.items.filter((p) => p.status === "active");
const card = products.find((p) => p.kind === "punch_card") ?? products[0];
await call(owner, "POST", `${s}/people/${buddyPerson}/passes`, { productId: card.id });

let pair = null;
for (const session of upcoming) {
  const map = (await call(owner, "GET", `${s}/sessions/${session.id}/spots`)).json;
  if (!map?.spotSelection) continue;
  const free = map.spots.filter((spot) => spot.state === "free");
  const left = free.find((spot) => free.some((other) => other.row === spot.row && other.col === spot.col + 1));
  if (left) {
    pair = { session, left, right: free.find((other) => other.row === left.row && other.col === left.col + 1) };
    break;
  }
}
if (pair) {
  await call(member, "POST", `${s}/sessions/${pair.session.id}/bookings`, { spotId: pair.left.id }, { expected: [201, 409] });
  await call(buddy, "POST", `${s}/sessions/${pair.session.id}/bookings`, { spotId: pair.right.id }, { expected: [201, 409] });
  done(`the test member and their buddy, spots ${pair.left.label} and ${pair.right.label} in the class of ${localParts(new Date(pair.session.startsAt)).date}`);
}

// 7. Passes sold this month.
const people = (await call(owner, "GET", `${s}/people?limit=50`)).json.items.filter((p) => p.status === "active" && p.id !== memberPerson && p.id !== buddyPerson);
const priced = products.filter((p) => (p.priceAgorot ?? 0) > 0);
let sold = 0;
for (const [index, person] of people.slice(0, 6).entries()) {
  const product = priced[index % Math.max(priced.length, 1)] ?? card;
  if ((await call(owner, "POST", `${s}/people/${person.id}/passes`, { productId: product.id }, { expected: [201, 409] })).status === 201) sold += 1;
}
done(`${sold} passes sold this month`);

// 8. Arrivals: a class in 20 minutes, five marked attended, the buddy scanned at the door.
const soon = localParts(new Date(Date.now() + 20 * 60_000));
const room = rooms[0];
const classType = classTypes.find((t) => coverFor(t) === PHOTOS.reformer) ?? classTypes[0];
const arrival = (await call(owner, "POST", `${s}/sessions`, {
  classTypeId: classType.id, localDate: soon.date, localStart: soon.time, minutes: 50, capacity: 8, roomId: room?.id, instructorMembershipId: instructors[1].membershipId,
})).json;
if (arrival?.id) {
  let attended = 0;
  for (const person of people.slice(0, 5)) {
    const booking = (await call(owner, "POST", `${s}/sessions/${arrival.id}/bookings`, { personId: person.id }, { expected: [201, 409] })).json;
    if (booking?.id && (await call(owner, "POST", `${s}/bookings/${booking.id}/attendance`, { state: "attended" })).status === 200) attended += 1;
  }
  await call(buddy, "POST", `${s}/sessions/${arrival.id}/bookings`, {}, { expected: [201, 409] });
  const code = (await call(buddy, "GET", `${s}/me/checkin-code`)).json?.code;
  const scan = (await call(instructors[1].token, "POST", `${s}/checkins`, { code })).json;
  done(`a class at ${soon.time}: ${attended} marked attended, the buddy scanned in at spot ${scan?.spotLabel ?? "?"}`);
}

console.log(failures === 0 ? `${slug} is dressed` : `${slug}: ${failures} calls failed (see above)`);
process.exit(failures === 0 ? 0 : 1);
