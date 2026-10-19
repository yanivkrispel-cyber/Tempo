#!/usr/bin/env node
/**
 * The white label and studio marketing live check on dev (board #380: K6, MK6, MK9; docs/35, docs/37), against the
 * real API, database and picture bucket. Three parts, each on its own flag:
 *
 *   --brand    K6 / WL6: test-studio-1 gets the ocean accent, an app name, a drawn logo and icon (a ring, never a real
 *              studio's mark); its public manifest and icons pass the install rules for `<members app>/s/test-studio-1/`.
 *              The brand stays (it is the demo). Chrome's Page.getInstallabilityErrors on the page is a separate step
 *              in a real browser, once the studio path (O5) is deployed.
 *   --stage-a  MK6: in the smoke studio, the public page on with an intro offer; a story link; the studio and its
 *              sessions read signed out; a fictional newcomer joins with the link's code and gets the intro pass; she
 *              books with the code, attends, and the source report counts her.
 *   --stage-b  MK9: a fictional member reaches the milestone of 10 attended classes; her referral link brings a friend
 *              whose first attended class rewards her; the friend books an event without a pass.
 *
 * Every person here is fictional (`e2e-marketing-<run>-…@example.com`, Cognito users made for this run). Cleanup:
 * classes cancelled, products archived, members erased and removed, Cognito users deleted, and the smoke studio's
 * public page set back to what it was.
 *
 * Usage (from a developer's machine; `--profile tempo` needs Cognito admin user calls, ssm:GetParameter and
 * cloudformation:DescribeStacks):
 *   node tools/scripts/marketing-live-check.mjs --brand --stage-a --stage-b [--profile tempo]
 *
 * Never prints passwords, tokens, presigned URLs or anyone's address.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ringPng, studioLocal } from "./lib/marketing-live.mjs";
import { uploadFormData } from "./lib/premium-live.mjs";
import { checkStudio } from "./lib/pwa-manifest.mjs";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const MEMBERS_APP = "https://tempo-members.pages.dev";
const BRAND_STUDIO = "test-studio-1";
const RUN = randomBytes(4).toString("hex");
const EMAIL = (who) => `e2e-marketing-${RUN}-${who}@example.com`;
const PREFIX = "e2e-marketing ";

const args = process.argv.slice(2);
const profileIndex = args.indexOf("--profile");
const profile = profileIndex >= 0 ? args[profileIndex + 1] : "tempo";
const parts = { brand: args.includes("--brand"), stageA: args.includes("--stage-a"), stageB: args.includes("--stage-b") };
if (!parts.brand && !parts.stageA && !parts.stageB) {
  console.error("usage: node tools/scripts/marketing-live-check.mjs [--brand] [--stage-a] [--stage-b] [--profile tempo]");
  process.exit(2);
}

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const ssm = (name) => JSON.parse(aws(["ssm", "get-parameter", "--name", name, "--with-decryption"])).Parameter.Value;

/** Runs `aws <args> --cli-input-json` from a private temporary file, so no value lands on a command line. */
function awsWithInput(cliArgs, input) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-marketing-"));
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

const people = [];
const hide = (text) => people.reduce((t, p) => t.replaceAll(p.email, `<${p.who}>`), text);

async function call(token, method, route, body, { expected = [200, 201, 202, 204], ifMatch } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return { status: response.status, json, headers: response.headers };
}

/** A fictional Cognito user for this run, signed in, with a Tempo account; deleted in `finally` whatever happens. */
async function newPerson(who) {
  const email = EMAIL(who);
  const person = { who, email };
  people.push(person);
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
  person.cognito = true;
  awsWithInput(["cognito-idp", "admin-set-user-password"], { UserPoolId: poolId, Username: email, Password: password, Permanent: true });
  person.token = signIn(email, password);
  await call(person.token, "POST", "/api/v1/session");
  return person;
}

async function upload(token, s, purpose, ownerId, png) {
  const ticket = (await call(token, "POST", `${s}/media/uploads`, { purpose, ownerId, contentType: "image/png", bytes: png.length })).json;
  const posted = await fetch(ticket.uploadForm.url, { method: "POST", body: uploadFormData(ticket.uploadForm.fields, png, "image/png") });
  check(posted.status === 204, `S3 took the ${purpose} through the presigned POST`);
  return (await call(token, "POST", `${s}/media/uploads/${ticket.mediaId}/finalize`)).json;
}

const smoke = signIn(ssm(`${smokePath}/email`), ssm(`${smokePath}/password`));
const me = (await call(smoke, "GET", "/api/v1/me")).json;

// --- K6 / WL6: the branded studio --------------------------------------------------------------------------------
if (parts.brand) {
  const membership = me.memberships.find((m) => m.organization.slug === BRAND_STUDIO);
  check(membership?.permissions.includes("organization.settings.manage") === true, `the smoke user may brand ${BRAND_STUDIO}`);
  if (membership) {
    const s = `/api/v1/organizations/${membership.organization.id}`;
    const before = (await call(smoke, "GET", `${s}/brand`)).json;
    const brand = (await call(smoke, "PUT", `${s}/brand`, { appName: "בדיקה 1", accentId: "ocean", iconBackground: "paper" }, { ifMatch: before.version })).json;
    check(brand?.accentId === "ocean" && brand.appName === "בדיקה 1", "the brand is saved: ocean, \"בדיקה 1\"");
    const logo = await upload(smoke, s, "studio_logo", membership.organization.id, ringPng(800, [0x3b, 0x5d, 0x73]));
    check(logo?.purpose === "studio_logo", "a drawn logo is in place");
    const icon = await upload(smoke, s, "studio_icon", membership.organization.id, ringPng(1024, [0x4a, 0x70, 0x88]));
    check(icon?.purpose === "studio_icon", "a drawn icon is in place (1024 px, drawn at 192, 512, maskable 512 and 180)");
    const after = (await call(smoke, "GET", `${s}/brand`)).json;
    check(Boolean(after?.iconUrl) && Boolean(after.logoUrl), "the brand answers with the logo and the installed icon");
    const problems = await checkStudio(API, MEMBERS_APP, BRAND_STUDIO);
    check(problems.length === 0, `the studio's manifest and icons pass the install rules${problems.length ? `: ${problems.join("; ")}` : ""}`);
    const apple = await fetch(`${API}/api/v1/public/studios/${BRAND_STUDIO}/icons/180?v=${after.version}`);
    check(apple.status === 200 && apple.headers.get("cache-control")?.includes("immutable") === true, "the iOS icon (180) answers, immutable");
  }
}

// --- MK6 and MK9: stage A and stage B in the smoke studio ---------------------------------------------------------
const studio = me.memberships.find((m) => m.role === "owner" && m.permissions.includes("marketing.publish"));
const s = studio ? `/api/v1/organizations/${studio.organization.id}` : null;
const slug = studio?.organization.slug;
let pageBefore = null;
const sessions = [];
const products = [];
const members = [];

const at = (minutes) => studioLocal(new Date(Date.now() + minutes * 60_000));

async function classIn(minutes, extra = {}) {
  const types = (await call(smoke, "GET", `${s}/class-types`)).json.items.filter((t) => t.status === "active");
  const session = (await call(smoke, "POST", `${s}/sessions`, { classTypeId: types[0].id, ...at(minutes), minutes: 30, capacity: 8, ...extra })).json;
  if (session?.id) sessions.push(session.id);
  return session;
}

async function joinPublic(who, src) {
  const person = await newPerson(who);
  const joined = (await call(person.token, "POST", `/api/v1/public/studios/${slug}/join`, { src })).json;
  person.membershipId = joined?.membershipId;
  person.introPass = joined?.introPass;
  person.personId = (await call(smoke, "GET", `${s}/people?query=${encodeURIComponent(person.email)}`)).json.items[0]?.id;
  members.push(person);
  return person;
}

async function attend(person, session) {
  const booking = (await call(person.token, "POST", `${s}/sessions/${session.id}/bookings`, {})).json;
  await call(smoke, "POST", `${s}/bookings/${booking.id}/attendance`, { state: "attended" });
  return booking;
}

try {
  if ((parts.stageA || parts.stageB) && !studio) {
    check(false, "the smoke user owns a studio with marketing.publish");
  } else if (parts.stageA || parts.stageB) {
    pageBefore = (await call(smoke, "GET", `${s}/public-page`)).json;
    const intro = (await call(smoke, "POST", `${s}/pass-products`, { kind: "punch_card", name: `${PREFIX}שיעור ניסיון`, entries: 12, validDays: 7, priceAgorot: 0 })).json;
    const reward = (await call(smoke, "POST", `${s}/pass-products`, { kind: "punch_card", name: `${PREFIX}מתנה`, entries: 1, validDays: 7, priceAgorot: 0 })).json;
    products.push(intro.id, reward.id);
    const page = (
      await call(smoke, "PUT", `${s}/public-page`, { ...pageBefore, enabled: true, openJoin: true, introProductId: intro.id, referralRewardProductId: reward.id }, { ifMatch: pageBefore.version })
    ).json;
    check(page?.enabled === true && page.openJoin === true, "the smoke studio's public page and open join are on, with an intro offer");

    if (parts.stageA) {
      // MK6: a story's link, read signed out, a newcomer joins and books with its code, and the report counts her.
      const soon = await classIn(25);
      const link = (await call(smoke, "POST", `${s}/marketing/links`, { channel: "story", template: "week", sessionId: soon.id })).json;
      check(link?.url?.startsWith(`${MEMBERS_APP}/s/${slug}/c/${soon.id}?src=`) === true, "a story link points at the class page with its code");
      const publicStudio = await call(null, "GET", `/api/v1/public/studios/${slug}`);
      check(publicStudio.status === 200 && publicStudio.json?.introOffer?.name?.startsWith(PREFIX) === true, "the studio reads signed out, with its intro offer");
      const publicClass = (await call(null, "GET", `/api/v1/public/studios/${slug}/sessions/${soon.id}`)).json;
      check(["open", "few"].includes(publicClass?.availability) && !("bookedCount" in (publicClass ?? {})), "the class reads signed out as a bucket, no count of people");
      const maya = await joinPublic("maya", link.code);
      check(Boolean(maya.membershipId) && maya.introPass?.toPayAtStudio === true, "a newcomer joined with the code and got the intro pass, to pay at the studio");
      const booking = (await call(maya.token, "POST", `${s}/sessions/${soon.id}/bookings`, { src: link.code })).json;
      await call(smoke, "POST", `${s}/bookings/${booking.id}/attendance`, { state: "attended" });
      const report = (await call(smoke, "GET", `${s}/reports/sources?days=7`)).json;
      const row = report?.byLink.find((l) => l.linkId === link.id);
      check(row?.members === 1 && row.bookings === 1 && row.attended === 1, "the source report counts her: 1 member, 1 booking, 1 attended");
    }

    if (parts.stageB) {
      // MK9: a milestone at 10, a referral reward, and an event without a pass.
      const noa = await joinPublic("noa", null);
      for (let i = 0; i < 10; i++) await attend(noa, await classIn(20));
      const milestones = (await call(noa.token, "GET", `${s}/me/milestones`)).json;
      check(milestones?.attended === 10 && milestones.reached.includes(10) && milestones.next === 25, "the member reached the milestone of 10");
      const inbox = (await call(noa.token, "GET", `${s}/me/notifications?limit=20`)).json;
      check((inbox?.items ?? []).some((item) => item.kind === "member.milestone"), "her inbox has the milestone notice");
      const referral = (await call(noa.token, "POST", `${s}/me/share-link`, { channel: "referral" })).json;
      const tal = await joinPublic("tal", referral?.code);
      await attend(tal, await classIn(20));
      const passes = (await call(smoke, "GET", `${s}/people/${noa.personId}/passes`)).json;
      check((passes?.items ?? []).some((p) => p.product?.id === reward.id), "her friend's first attended class gave her the reward");
      const event = await classIn(24 * 60, { event: { title: `${PREFIX}סדנה`, priceAgorot: 0, passRequired: false } });
      const fresh = await newPerson("lior");
      await call(fresh.token, "POST", `/api/v1/public/studios/${slug}/join`, {});
      fresh.personId = (await call(smoke, "GET", `${s}/people?query=${encodeURIComponent(fresh.email)}`)).json.items[0]?.id;
      members.push(fresh);
      const eventBooking = (await call(fresh.token, "POST", `${s}/sessions/${event.id}/bookings`, {})).json;
      check(eventBooking?.toPayAtStudio === true && eventBooking.pass === null, "an event is booked without a pass, to pay at the studio");
    }
  }
} finally {
  for (const id of sessions) await call(smoke, "POST", `${s}/sessions/${id}/cancel`, undefined, { expected: [200, 409] });
  for (const id of products) await call(smoke, "POST", `${s}/pass-products/${id}/archive`, undefined, { expected: [200, 409] });
  for (const m of members) {
    if (m.personId) await call(smoke, "POST", `${s}/people/${m.personId}/erase`, { reason: "e2e marketing live check" }, { expected: [200, 204, 409] });
    if (m.membershipId) await call(smoke, "DELETE", `${s}/members/${m.membershipId}`, undefined, { expected: [200, 204, 404, 409] });
  }
  for (const p of people) {
    if (!p.cognito) continue;
    try {
      awsWithInput(["cognito-idp", "admin-delete-user"], { UserPoolId: poolId, Username: p.email });
    } catch {
      // Already gone.
    }
  }
  if (pageBefore && s) {
    const current = (await call(smoke, "GET", `${s}/public-page`)).json;
    await call(smoke, "PUT", `${s}/public-page`, { ...pageBefore, introProductId: null, referralRewardProductId: null }, { ifMatch: current.version, expected: [200] });
  }
  console.log("cleanup: classes cancelled, products archived, members erased and removed, Cognito users deleted, the public page set back");
}

console.log(failures === 0 ? "marketing live check: all passed" : `marketing live check: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
