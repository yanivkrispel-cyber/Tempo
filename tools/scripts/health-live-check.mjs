#!/usr/bin/env node
/**
 * The health declaration and progress live check on dev (day board #232, H5; docs/31), after the P6 and T5 checks.
 *
 * In the smoke studio, the smoke user is the owner; one fresh e2e member (`e2e-health-<run>@example.com`, a
 * Cognito user made for this run) is invited and joins:
 *   1. the gate: with `requireHealthDeclaration` on, the unsigned member's own booking is refused (409
 *      `health.declaration_required`); the gate goes back to what it was in `finally`
 *   2. the member signs (every answer "no"); the raw row holds ciphertext only (format byte, no marker, no name)
 *   3. staff read the status (no answers in it); the owner reads the answers once, and the audit has one
 *      `health.declaration.viewed` for it, with no content
 *   4. the signed member books; a one-off class starting in 20 minutes is marked attended, and the member's
 *      progress counts one more visit this month
 *   5. the API and worker logs since the start hold neither the marker nor the member's address
 *   6. the Neon project's usage before and after
 *
 * Cleanup: the gate restored, the class cancelled, the card product archived, the member's person erased (which
 * deletes the declaration), the membership removed and the Cognito user deleted.
 *
 * Usage (from a developer's machine; `--profile tempo` needs Cognito admin user calls, ssm:GetParameter,
 * cloudformation:DescribeStacks and logs:FilterLogEvents):
 *   node tools/scripts/health-live-check.mjs [--profile tempo]
 *
 * Never prints secret values, passwords, tokens, the marker or the member's address. The answers are generic and
 * all "no": no real health data.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const NEON_API = "https://console.neon.tech/api/v2";
// The dev project and database, as in infrastructure/config/development.ts.
const NEON_PROJECT_ID = "wild-darkness-22822656";
const DATABASE = "neondb";
const RUN = randomBytes(5).toString("hex");
// One marker per run, in the signed name, so the row, the audit and the logs can be searched for it.
const MARK = `hc${RUN}`;
const MEMBER_EMAIL = `e2e-health-${RUN}@example.com`;
const PREFIX = "e2e-health ";

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
  const dir = mkdtempSync(join(tmpdir(), "tempo-health-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(aws([...cliArgs, "--cli-input-json", `file://${file}`]) || "{}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const neonKey = ssm("/tempo/dev/neon/api-key");
async function neon(path) {
  const response = await fetch(`${NEON_API}${path}`, { headers: { Authorization: `Bearer ${neonKey}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Neon API ${path} → ${response.status}`);
  return response.json();
}

async function neonUsage() {
  const { project } = await neon(`/projects/${NEON_PROJECT_ID}`);
  return { computeSeconds: project.compute_time_seconds, egressBytes: project.data_transfer_bytes };
}

/** Neon's SQL-over-HTTP endpoint as the owner role (no RLS): one statement, the connection string in a header. */
async function sql(query, params = []) {
  const branches = (await neon(`/projects/${NEON_PROJECT_ID}/branches`)).branches;
  const main = branches.find((b) => b.default);
  const { uri } = await neon(
    `/projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${main.id}&database_name=${DATABASE}&role_name=neondb_owner&pooled=false`,
  );
  const response = await fetch(`https://${new URL(uri).hostname}/sql`, {
    method: "POST",
    headers: { "Neon-Connection-String": uri, "Content-Type": "application/json" },
    body: JSON.stringify({ query, params }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`SQL → ${response.status}`);
  return body.rows;
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
    const shown = text.slice(0, 200).replaceAll(MARK, "<mark>").replaceAll(MEMBER_EMAIL, "<member>");
    console.log(`✗ ${method} ${route.replace(/\/organizations\/[0-9a-f-]+/, "/{studio}")} → ${response.status} ${shown}`);
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the status says enough.
  }
  return { status: response.status, json, text, headers: response.headers };
}

const before = await neonUsage();
console.log(`Neon before: compute ${before.computeSeconds} s, egress ${before.egressBytes} B`);

const owner = signIn(ssm(`${smokePath}/email`), ssm(`${smokePath}/password`));
const me = (await call(owner, "GET", "/api/v1/me")).json;
const studio = me.memberships.find((m) => m.permissions.includes("health.view") && m.permissions.includes("schedule.manage"));
const s = `/api/v1/organizations/${studio.organization.id}`;
const originalPolicy = (await call(owner, "GET", `${s}/booking-policy`)).json;

let memberCreated = false;
let membershipId;
let personId;
let product;
let session;
try {
  // The e2e member: a Cognito user for this run only, invited as a client, joined.
  const password = `${randomBytes(12).toString("base64url")}aA1!`;
  awsWithInput(["cognito-idp", "admin-create-user"], {
    UserPoolId: poolId,
    Username: MEMBER_EMAIL,
    UserAttributes: [
      { Name: "email", Value: MEMBER_EMAIL },
      { Name: "email_verified", Value: "true" },
    ],
    MessageAction: "SUPPRESS",
  });
  memberCreated = true;
  awsWithInput(["cognito-idp", "admin-set-user-password"], { UserPoolId: poolId, Username: MEMBER_EMAIL, Password: password, Permanent: true });
  const member = signIn(MEMBER_EMAIL, password);
  // A first sign-in creates the Tempo account (startSession), as the apps do.
  await call(member, "POST", "/api/v1/session");
  const invitation = (await call(owner, "POST", `${s}/invitations`, { email: MEMBER_EMAIL, role: "client" })).json;
  const joined = (await call(member, "POST", "/api/v1/invitations/accept", { token: new URL(invitation.link).hash.slice(1) })).json;
  membershipId = joined?.membershipId;
  personId = (await call(owner, "GET", `${s}/people?query=${encodeURIComponent(MEMBER_EMAIL)}`)).json.items[0]?.id;
  check(Boolean(membershipId && personId), "an e2e member joined the smoke studio by invitation");
  if (!membershipId || !personId) throw new Error("the e2e member could not join; nothing else can run");

  // A card, and a one-off class starting in 20 minutes (attendance opens 30 minutes before a class).
  product = (await call(owner, "POST", `${s}/pass-products`, { kind: "punch_card", name: `${PREFIX}כרטיסייה`, entries: 2, validDays: 2, priceAgorot: 0 })).json;
  await call(owner, "POST", `${s}/people/${personId}/passes`, { productId: product.id });
  const classType = (await call(owner, "GET", `${s}/class-types`)).json.items.find((t) => t.status === "active");
  const startsLocal = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(Date.now() + 20 * 60_000));
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(Date.now() + 20 * 60_000));
  session = (await call(owner, "POST", `${s}/sessions`, { classTypeId: classType.id, localDate, localStart: startsLocal, minutes: 30, capacity: 2 })).json;

  // 1. The gate refuses the unsigned member.
  await call(owner, "PUT", `${s}/booking-policy`, { ...originalPolicy, version: undefined, requireHealthDeclaration: true }, { ifMatch: originalPolicy.version });
  const mine = (await call(member, "GET", `${s}/me/health-declaration`)).json;
  check(mine?.declaration.status === "missing" && mine.required === true, "the member sees status missing and that the studio requires it");
  const refused = await call(member, "POST", `${s}/sessions/${session.id}/bookings`, undefined, { expected: [409] });
  check(refused.status === 409 && refused.text.includes("health.declaration_required"), "the gate refuses the unsigned member's own booking (409 health.declaration_required)");

  // 2. The member signs; the raw row holds ciphertext only.
  const signed = await call(member, "POST", `${s}/me/health-declaration`, {
    formVersion: mine.form.version,
    answers: mine.form.questions.map((q) => ({ questionId: q.id, answer: false })),
    signedName: `${PREFIX}${MARK}`,
    signerRole: "self",
    confirmed: true,
  });
  check(signed.status === 201 && signed.json.declaration.status === "signed", "the member signs (all answers no): status signed");
  const [row] = await sql(
    `SELECT encode(substring(answers_ciphertext from 1 for 1), 'hex') AS format, key_version, has_yes,
            position(convert_to($2, 'UTF8') in answers_ciphertext || signed_name_ciphertext) AS found,
            position($2 in d::text) AS found_text
     FROM people.health_declarations d WHERE person_id = $1 AND superseded_at IS NULL`,
    [personId, MARK],
  );
  check(row?.format === "01" && row.key_version === 1 && row.has_yes === false && row.found === 0 && row.found_text === 0,
    "the raw row holds ciphertext only (format 01, key version 1, the marker in no column)");

  // 3. Staff read the status; the owner reads the answers once, audited without content.
  const status = await call(owner, "GET", `${s}/people/${personId}/health-declaration`);
  check(status.json?.status === "signed" && !status.text.includes("answers") && !status.text.includes(MARK), "staff read the status, with no answers and no name");
  const answers = await call(owner, "GET", `${s}/people/${personId}/health-declaration/answers`);
  check(answers.json?.signedName === `${PREFIX}${MARK}` && answers.headers.get("cache-control") === "no-store", "the owner reads the answers, sent no-store");
  const audit = await sql(
    `SELECT action, data::text AS data FROM audit.audit_events
     WHERE target_id = $1::uuid AND action LIKE 'health.%' ORDER BY occurred_at`,
    [signed.json.declaration.declarationId],
  );
  check(
    audit.filter((a) => a.action === "health.declaration.viewed").length === 1 && audit.every((a) => !a.data.includes(MARK) && !a.data.includes("answer")),
    `the audit has ${audit.map((a) => a.action).join(", ")}, with no content`,
  );

  // 4. Signed, the member books; attended, the visit counts.
  const progressBefore = (await call(member, "GET", `${s}/me/progress`)).json;
  const booking = (await call(member, "POST", `${s}/sessions/${session.id}/bookings`)).json;
  check(booking?.status === "booked", "signed, the member books the class");
  await call(owner, "POST", `${s}/bookings/${booking.id}/attendance`, { state: "attended" });
  const progressAfter = (await call(member, "GET", `${s}/me/progress`)).json;
  check(progressAfter?.visitsThisMonth === progressBefore.visitsThisMonth + 1 && progressAfter.streakWeeks >= 1,
    `progress follows the attendance: visits ${progressBefore.visitsThisMonth} → ${progressAfter?.visitsThisMonth}, streak ${progressAfter?.streakWeeks}`);
} finally {
  const policy = (await call(owner, "GET", `${s}/booking-policy`)).json;
  await call(owner, "PUT", `${s}/booking-policy`, {
    freeCancelHours: originalPolicy.freeCancelHours,
    waitlistCutoffHours: originalPolicy.waitlistCutoffHours,
    bookingHorizonDays: originalPolicy.bookingHorizonDays,
    waitlistEnabled: originalPolicy.waitlistEnabled,
    requireHealthDeclaration: originalPolicy.requireHealthDeclaration ?? false,
  }, { ifMatch: policy.version });
  check((await call(owner, "GET", `${s}/booking-policy`)).json.requireHealthDeclaration === (originalPolicy.requireHealthDeclaration ?? false), "the gate is back to what it was");
  if (session?.id) await call(owner, "POST", `${s}/sessions/${session.id}/cancel`, undefined, { expected: [200, 409] });
  if (product?.id) await call(owner, "POST", `${s}/pass-products/${product.id}/archive`, undefined);
  if (personId) {
    await call(owner, "POST", `${s}/people/${personId}/erase`, { reason: "e2e health live check" });
    const left = await sql("SELECT count(*)::int AS n FROM people.health_declarations WHERE person_id = $1", [personId]);
    check(left[0].n === 0, "erasing the e2e member deleted the declaration");
  }
  if (membershipId) await call(owner, "DELETE", `${s}/members/${membershipId}`, undefined, { expected: [200, 204, 404, 409] });
  if (memberCreated) awsWithInput(["cognito-idp", "admin-delete-user"], { UserPoolId: poolId, Username: MEMBER_EMAIL });
  console.log("cleanup: gate restored, class cancelled, product archived, member erased and removed, Cognito user deleted");
}

// 5. Nothing logged with the marker or the member's address.
for (const group of ["/aws/lambda/tempo-dev-api", "/aws/lambda/tempo-dev-worker-outbox"]) {
  for (const [label, needle] of [["the signed name's marker", MARK], ["the member's address", MEMBER_EMAIL]]) {
    const found = awsWithInput(["logs", "filter-log-events"], { logGroupName: group, startTime: started, filterPattern: `"${needle}"` }).events?.length ?? 0;
    check(found === 0, `${group}: ${label} in no log line`);
  }
}

// 6. Neon usage.
const after = await neonUsage();
console.log(`Neon after: compute +${after.computeSeconds - before.computeSeconds} s, egress +${after.egressBytes - before.egressBytes} B`);

console.log(failures === 0 ? "all checks passed" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
