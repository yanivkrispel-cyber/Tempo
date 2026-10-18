#!/usr/bin/env node
/**
 * The premium live check on dev (board #347, K4; docs/33 section 13): the Warm Glass capabilities end to end against
 * the real API, database and picture bucket.
 *
 * In the smoke studio, the smoke user is the owner; two fresh e2e members (`e2e-premium-<run>-a|b@example.com`,
 * Cognito users made for this run) are invited and join:
 *   1. a room with spots (the reusable `e2e-premium` room, 2 x 3, spot selection on) and a one-off class in it
 *      starting in 20 minutes; both members get a card
 *   2. a buddy link by consent: A shares a one-time code, B enters it
 *   3. A books spot 2; B books spot 3, next to A, and B's room map names A as a buddy
 *   4. a picture through the real bucket: A uploads an avatar with the presigned POST, the API re-encodes it, its
 *      URL answers image/webp; a file one byte over 8 MB is refused by S3 itself (EntityTooLarge)
 *   5. the scan at the door: the owner scans A's code, and the live map shows A's spot attended
 *   6. the owner's insights (sales, occupancy, suggestions, activity) and search answer
 *
 * Cleanup: the buddy link removed, the class cancelled, the card product archived, both members erased (which
 * deletes the avatar's objects) and removed, the Cognito users deleted, the room archived.
 *
 * Usage (from a developer's machine; `--profile tempo` needs Cognito admin user calls, ssm:GetParameter and
 * cloudformation:DescribeStacks):
 *   node tools/scripts/premium-live-check.mjs [--profile tempo]
 *
 * Never prints passwords, tokens, presigned URLs or the members' addresses. The people are fictional.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { s3ErrorCode, solidPng, uploadFormData } from "./lib/premium-live.mjs";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const RUN = randomBytes(4).toString("hex");
const EMAIL = (who) => `e2e-premium-${RUN}-${who}@example.com`;
const PREFIX = "e2e-premium ";
const ROOM_NAME = "e2e-premium";

const profileIndex = process.argv.indexOf("--profile");
const profile = profileIndex > 0 ? process.argv[profileIndex + 1] : "tempo";

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const ssm = (name) => JSON.parse(aws(["ssm", "get-parameter", "--name", name, "--with-decryption"])).Parameter.Value;

/** Runs `aws <args> --cli-input-json` from a private temporary file, so no value lands on a command line. */
function awsWithInput(cliArgs, input) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-premium-"));
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
const smokePath = out("SmokeTestParameterPath");

const signIn = (username, password) =>
  awsWithInput(["cognito-idp", "admin-initiate-auth"], {
    UserPoolId: poolId,
    ClientId: clientId,
    AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD: password },
  }).AuthenticationResult.AccessToken;

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};

const hide = (text) => text.replaceAll(EMAIL("a"), "<member a>").replaceAll(EMAIL("b"), "<member b>");

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
  if (!expected.includes(response.status)) {
    failures += 1;
    console.log(`✗ ${method} ${route.replace(/\/organizations\/[0-9a-f-]+/, "/{studio}")} → ${response.status} ${hide(text.slice(0, 200))}`);
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the status says enough.
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** A Cognito user for this run, signed in, with a Tempo account, invited as a client and joined. */
async function joinMember(owner, s, who) {
  const email = EMAIL(who);
  const password = `${randomBytes(12).toString("base64url")}aA1!`;
  awsWithInput(["cognito-idp", "admin-create-user"], {
    UserPoolId: poolId,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
    ],
    MessageAction: "SUPPRESS",
  });
  const member = { email, cognito: true };
  awsWithInput(["cognito-idp", "admin-set-user-password"], { UserPoolId: poolId, Username: email, Password: password, Permanent: true });
  member.token = signIn(email, password);
  await call(member.token, "POST", "/api/v1/session");
  const invitation = (await call(owner, "POST", `${s}/invitations`, { email, role: "client" })).json;
  member.membershipId = (await call(member.token, "POST", "/api/v1/invitations/accept", { token: new URL(invitation.link).hash.slice(1) })).json?.membershipId;
  member.personId = (await call(owner, "GET", `${s}/people?query=${encodeURIComponent(email)}`)).json.items[0]?.id;
  return member;
}

const owner = signIn(ssm(`${smokePath}/email`), ssm(`${smokePath}/password`));
const me = (await call(owner, "GET", "/api/v1/me")).json;
const studio = me.memberships.find((m) => ["schedule.manage", "reports.view", "attendance.mark"].every((p) => m.permissions.includes(p)));
const s = `/api/v1/organizations/${studio.organization.id}`;

const members = [];
let room;
let product;
let session;
try {
  // 1. The room, the class, the members and their cards.
  const rooms = (await call(owner, "GET", `${s}/rooms`)).json.items;
  room = rooms.find((r) => r.name === ROOM_NAME);
  if (!room) {
    room = (await call(owner, "POST", `${s}/rooms`, { name: ROOM_NAME, defaultCapacity: 6 })).json;
  } else if (room.status !== "active") {
    room = (await call(owner, "PATCH", `${s}/rooms/${room.id}`, { status: "active" }, { ifMatch: room.version })).json;
  }
  const layout = (await call(owner, "GET", `${s}/rooms/${room.id}/layout`)).json;
  const spots = [0, 1].flatMap((row) => [0, 1, 2].map((col) => ({ label: String(row * 3 + col + 1), row, col })));
  const saved = (
    await call(
      owner,
      "PUT",
      `${s}/rooms/${room.id}/layout`,
      { spotSelection: true, rows: 2, cols: 3, windowSide: "start", mirrorFront: true, spots: spots.map((spot) => ({ ...spot, id: layout.spots.find((old) => old.label === spot.label)?.id })) },
      { ifMatch: layout.version },
    )
  ).json;
  check(saved?.spotSelection === true && saved.spots.length === 6, "the e2e room has 6 spots in 2 rows, spot selection on");
  const spotByLabel = (label) => saved.spots.find((spot) => spot.label === label);

  for (const who of ["a", "b"]) members.push(await joinMember(owner, s, who));
  const [a, b] = members;
  check(members.every((m) => m.membershipId && m.personId), "two e2e members joined the smoke studio by invitation");
  if (!members.every((m) => m.membershipId && m.personId)) throw new Error("the e2e members could not join; nothing else can run");

  product = (await call(owner, "POST", `${s}/pass-products`, { kind: "punch_card", name: `${PREFIX}כרטיסייה`, entries: 2, validDays: 2, priceAgorot: 0 })).json;
  for (const m of members) await call(owner, "POST", `${s}/people/${m.personId}/passes`, { productId: product.id });
  const classType = (await call(owner, "GET", `${s}/class-types`)).json.items.find((t) => t.status === "active");
  const at = new Date(Date.now() + 20 * 60_000);
  const localStart = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(at);
  session = (await call(owner, "POST", `${s}/sessions`, { classTypeId: classType.id, localDate, localStart, minutes: 30, capacity: 6, roomId: room.id })).json;
  check(Boolean(session?.id), "a one-off class in the e2e room starts in 20 minutes");

  // 2. Buddies by consent.
  const code = (await call(a.token, "POST", `${s}/me/buddy-code`)).json?.code;
  const linked = await call(b.token, "POST", `${s}/me/buddies`, { code });
  check(linked.status === 200 && linked.json?.personId === a.personId, "B entered A's one-time code: they are buddies");

  // 3. Spots: A takes 2, B takes 3 next to A and sees A named on the map.
  const bookingA = (await call(a.token, "POST", `${s}/sessions/${session.id}/bookings`, { spotId: spotByLabel("2").id })).json;
  const bookingB = (await call(b.token, "POST", `${s}/sessions/${session.id}/bookings`, { spotId: spotByLabel("3").id })).json;
  check(bookingA?.status === "booked" && bookingB?.status === "booked", "A booked spot 2 and B spot 3");
  const mapForB = (await call(b.token, "GET", `${s}/sessions/${session.id}/spots`)).json;
  const twoForB = mapForB?.spots.find((spot) => spot.label === "2");
  check(
    mapForB?.mySpotId === spotByLabel("3").id && twoForB?.state === "buddy" && twoForB.person?.id === a.personId,
    "B's map shows spot 3 as theirs and spot 2 as their buddy A, by name",
  );
  const oneForB = mapForB?.spots.find((spot) => spot.label === "1");
  check(oneForB?.state === "free" && !oneForB.person, "a member sees nobody's name on a spot that isn't a buddy's");

  // 4. A picture through the real bucket.
  const picture = solidPng(640, 640, [0x56, 0x73, 0x5b]);
  const ticket = (await call(a.token, "POST", `${s}/media/uploads`, { purpose: "avatar", ownerId: a.personId, contentType: "image/png", bytes: picture.length })).json;
  check(ticket?.maxBytes === 8 * 1024 * 1024 && Boolean(ticket.uploadForm?.url), "the upload ticket is a presigned POST capped at 8 MB");
  const posted = await fetch(ticket.uploadForm.url, { method: "POST", body: uploadFormData(ticket.uploadForm.fields, picture, "image/png") });
  check(posted.status === 204, `S3 took the picture through the POST (${posted.status})`);
  const finalized = await call(a.token, "POST", `${s}/media/uploads/${ticket.mediaId}/finalize`);
  check(finalized.status === 200 && finalized.json?.width === 640, "the API re-encoded it (640 x 640)");
  const avatar = await fetch(finalized.json.smallUrl);
  check(avatar.status === 200 && avatar.headers.get("content-type") === "image/webp", "its small URL answers image/webp");

  const big = (await call(a.token, "POST", `${s}/media/uploads`, { purpose: "avatar", ownerId: a.personId, contentType: "image/png", bytes: 8 * 1024 * 1024 })).json;
  const refused = await fetch(big.uploadForm.url, { method: "POST", body: uploadFormData(big.uploadForm.fields, Buffer.alloc(8 * 1024 * 1024 + 1, 7), "image/png") });
  const refusedCode = s3ErrorCode(await refused.text());
  check(refused.status === 400 && refusedCode === "EntityTooLarge", `S3 itself refused a file one byte over 8 MB (${refused.status} ${refusedCode})`);
  const unfinished = await call(a.token, "POST", `${s}/media/uploads/${big.mediaId}/finalize`, undefined, { expected: [409] });
  check(unfinished.status === 409, "finalizing the refused upload finds nothing (409)");

  // 5. The scan at the door, and the live map.
  const codeA = (await call(a.token, "GET", `${s}/me/checkin-code`)).json;
  check(codeA?.openClass?.sessionId === session.id, "A's check-in code opens the class");
  const scan = (await call(owner, "POST", `${s}/checkins`, { code: codeA.code })).json;
  check(scan?.person?.id === a.personId && scan.spotLabel === "2" && scan.alreadyCheckedIn === false, "the owner scanned A: spot 2, checked in");
  const map = (await call(owner, "GET", `${s}/sessions/${session.id}/spots`)).json;
  const two = map?.spots.find((spot) => spot.label === "2");
  const three = map?.spots.find((spot) => spot.label === "3");
  check(two?.attendance === "attended" && three?.attendance === "booked" && Boolean(two.person?.avatarUrl), "the live map shows A attended (with the avatar) and B still booked");

  // 6. The owner's insights and search.
  for (const part of ["sales", "occupancy", "suggestions", "activity"]) {
    const insight = await call(owner, "GET", `${s}/insights/${part}`);
    check(insight.status === 200, `insights/${part} answers 200`);
  }
  const found = (await call(owner, "GET", `${s}/search?q=${encodeURIComponent(PREFIX.trim())}`)).json;
  check(found !== null, "search answers");
} finally {
  const [a, b] = members;
  if (a?.token && b?.personId) await call(a.token, "DELETE", `${s}/me/buddies/${b.personId}`, undefined, { expected: [204, 404] });
  if (session?.id) await call(owner, "POST", `${s}/sessions/${session.id}/cancel`, undefined, { expected: [200, 409] });
  if (product?.id) await call(owner, "POST", `${s}/pass-products/${product.id}/archive`, undefined);
  for (const m of members) {
    if (m.personId) await call(owner, "POST", `${s}/people/${m.personId}/erase`, { reason: "e2e premium live check" });
    if (m.membershipId) await call(owner, "DELETE", `${s}/members/${m.membershipId}`, undefined, { expected: [200, 204, 404, 409] });
    if (m.cognito) awsWithInput(["cognito-idp", "admin-delete-user"], { UserPoolId: poolId, Username: m.email });
  }
  if (room?.id) {
    const current = (await call(owner, "GET", `${s}/rooms`)).json.items.find((r) => r.id === room.id);
    if (current?.status === "active") await call(owner, "PATCH", `${s}/rooms/${room.id}`, { status: "archived" }, { ifMatch: current.version, expected: [200, 409] });
  }
  console.log("cleanup: buddies unlinked, class cancelled, product archived, members erased and removed, Cognito users deleted, room archived");
}

console.log(failures === 0 ? "premium live check: all passed" : `premium live check: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
