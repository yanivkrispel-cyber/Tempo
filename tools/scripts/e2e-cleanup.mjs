#!/usr/bin/env node
/**
 * Removes what e2e runs leave on dev (day board #253, A4; docs/32 section 12): Cognito logins `e2e-…@example.com`
 * and studios whose slug starts with `e2e-`. Nothing else is ever matched (lib/e2e-names.mjs and its test).
 *
 * Without --apply it only lists them. With --apply:
 *   1. studios first, through the operator API (A-3): suspend if active, then DELETE with the name typed. This needs
 *      a fresh operator access token (MFA, signed in within 10 minutes) in TEMPO_OPERATOR_TOKEN; without it the
 *      studios are skipped and listed.
 *   2. then each login through DELETE /me (A-1), signed in as that user with a one-time password set by the admin
 *      call. A login that still owns a studio gets 409 and is reported; a Cognito user without an account (never
 *      called POST /session) is deleted with admin-delete-user.
 *   3. account rows of e2e logins whose Cognito user is already gone are listed only: DELETE /me needs a sign-in.
 *   4. the Neon project's usage before and after.
 *
 * Usage (from a developer's machine; `--profile tempo` needs Cognito admin user calls, ssm:GetParameter and
 * cloudformation:DescribeStacks):
 *   node tools/scripts/e2e-cleanup.mjs [--profile tempo]                       # list only
 *   TEMPO_OPERATOR_TOKEN=… node tools/scripts/e2e-cleanup.mjs --apply           # remove
 *
 * Never prints passwords or tokens. The e2e addresses are fictional (example.com).
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isE2eEmail, isE2eStudio } from "./lib/e2e-names.mjs";

const REGION = "eu-central-1";
const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
const NEON_API = "https://console.neon.tech/api/v2";
// The dev project and database, as in infrastructure/config/development.ts.
const NEON_PROJECT_ID = "wild-darkness-22822656";
const DATABASE = "neondb";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const profileIndex = argv.indexOf("--profile");
const profile = profileIndex >= 0 ? argv[profileIndex + 1] : "tempo";
const operatorToken = process.env.TEMPO_OPERATOR_TOKEN || null;

const aws = (cliArgs) =>
  execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const ssm = (name) => JSON.parse(aws(["ssm", "get-parameter", "--name", name, "--with-decryption"])).Parameter.Value;

/** Runs `aws <args> --cli-input-json` from a private temporary file, so no value lands on a command line. */
function awsWithInput(cliArgs, input) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-e2e-cleanup-"));
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

/** Neon's SQL-over-HTTP endpoint as the owner role, read only here: one statement, the connection string in a header. */
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

async function call(token, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the status says enough.
  }
  return { status: response.status, json };
}

/** Every Cognito user whose address the filter accepts; the server-side prefix filter only narrows the pages. */
function e2eLogins() {
  const users = [];
  let token;
  do {
    const page = awsWithInput(["cognito-idp", "list-users"], {
      UserPoolId: poolId,
      Filter: 'email ^= "e2e-"',
      ...(token ? { PaginationToken: token } : {}),
    });
    for (const user of page.Users ?? []) {
      const email = user.Attributes?.find((a) => a.Name === "email")?.Value;
      if (isE2eEmail(email)) users.push({ username: user.Username, email });
    }
    token = page.PaginationToken;
  } while (token);
  return users;
}

const before = await neonUsage();
console.log(`Neon before: compute ${before.computeSeconds} s, egress ${before.egressBytes} B`);

const studios = (await sql("SELECT id, slug, display_name, status FROM organizations.organizations WHERE slug LIKE 'e2e-%' ORDER BY created_at"))
  .map((row) => ({ id: row.id, slug: row.slug, displayName: row.display_name, status: row.status }))
  .filter(isE2eStudio);
const logins = e2eLogins();
// Account rows whose Cognito user an earlier run already deleted (P2 F6). DELETE /me needs a sign-in, so these are
// only listed; they own nothing once their studios are removed.
const cognitoEmails = new Set(logins.map((l) => l.email.toLowerCase()));
const orphans = (await sql("SELECT email FROM identity.user_accounts WHERE email LIKE 'e2e-%' ORDER BY created_at"))
  .map((row) => row.email)
  .filter((email) => isE2eEmail(email) && !cognitoEmails.has(email.toLowerCase()));

console.log(`\n${studios.length} e2e studio(s):`);
for (const s of studios) console.log(`  ${s.slug}  ${s.status}  ${s.id}`);
console.log(`\n${logins.length} e2e login(s):`);
for (const l of logins) console.log(`  ${l.email}`);
console.log(`
${orphans.length} e2e account row(s) with no Cognito user (listed only):`);
for (const email of orphans) console.log(`  ${email}`);

let failures = 0;
if (!apply) {
  console.log("\nList only. Run again with --apply (and TEMPO_OPERATOR_TOKEN for the studios) to remove them.");
} else {
  if (studios.length > 0 && !operatorToken) {
    console.log("\nStudios skipped: set TEMPO_OPERATOR_TOKEN to a fresh operator access token (Kris, MFA).");
  }

  for (const studio of operatorToken ? studios : []) {
    if (studio.status === "active") {
      const suspended = await call(operatorToken, "POST", `/api/v1/platform/organizations/${studio.id}/suspend`, { reason: "e2e cleanup (A4)" });
      if (suspended.status !== 200) {
        failures += 1;
        console.log(`✗ suspend ${studio.slug} → ${suspended.status} ${suspended.json?.code ?? ""}`);
        continue;
      }
    }
    const removed = await call(operatorToken, "DELETE", `/api/v1/platform/organizations/${studio.id}`, { confirmName: studio.displayName });
    if (removed.status === 204) {
      console.log(`✓ removed studio ${studio.slug}`);
    } else {
      failures += 1;
      console.log(`✗ remove ${studio.slug} → ${removed.status} ${removed.json?.code ?? ""}`);
    }
  }

  for (const login of logins) {
    const password = `Tmp-${randomBytes(18).toString("base64url")}9a`;
    awsWithInput(["cognito-idp", "admin-set-user-password"], { UserPoolId: poolId, Username: login.username, Password: password, Permanent: true });
    const token = awsWithInput(["cognito-idp", "admin-initiate-auth"], {
      UserPoolId: poolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: login.username, PASSWORD: password },
    }).AuthenticationResult.AccessToken;

    const deleted = await call(token, "DELETE", "/api/v1/me", { confirmEmail: login.email });
    if (deleted.status === 204) {
      console.log(`✓ deleted login ${login.email}`);
    } else if (deleted.status === 404 && deleted.json?.code === "account.not_provisioned") {
      // Never started a session: there is no account row, only the Cognito user.
      awsWithInput(["cognito-idp", "admin-delete-user"], { UserPoolId: poolId, Username: login.username });
      console.log(`✓ deleted Cognito user ${login.email} (no account)`);
    } else {
      failures += 1;
      console.log(`✗ delete ${login.email} → ${deleted.status} ${deleted.json?.code ?? ""}`);
    }
  }
}

const after = await neonUsage();
console.log(`\nNeon after: compute ${after.computeSeconds} s (+${after.computeSeconds - before.computeSeconds}), egress ${after.egressBytes} B`);
process.exit(failures === 0 ? 0 : 1);
