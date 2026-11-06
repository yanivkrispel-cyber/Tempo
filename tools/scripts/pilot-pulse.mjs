#!/usr/bin/env node
/**
 * The pilot pulse (board #584, K5): how each studio on dev is doing, read-only, counts only. Per studio: members and
 * staff, people, weekly classes, classes in the next 7 days, places booked and attended in the last 7 and 28 days,
 * active passes, and the day a staff member last signed in. No name, email, phone or note is read or printed
 * (lib/pilot-pulse.mjs and its test), so the table can go into a board comment as it is.
 *
 * It runs one SELECT through Neon's SQL-over-HTTP endpoint as the owner role, like e2e-cleanup.mjs, and writes nothing.
 * e2e studios (slug `e2e-…`) are left out unless --all is given.
 *
 * Usage (from a developer's machine; `--profile tempo` needs ssm:GetParameter on /tempo/dev/neon/api-key):
 *   node tools/scripts/pilot-pulse.mjs [--profile tempo] [--all]
 */

import { execFileSync } from "node:child_process";

import { PULSE_SQL, formatPulse } from "./lib/pilot-pulse.mjs";

const REGION = "eu-central-1";
const NEON_API = "https://console.neon.tech/api/v2";
// The dev project and database, as in infrastructure/config/development.ts.
const NEON_PROJECT_ID = "wild-darkness-22822656";
const DATABASE = "neondb";

const argv = process.argv.slice(2);
const all = argv.includes("--all");
const profileIndex = argv.indexOf("--profile");
const profile = profileIndex >= 0 ? argv[profileIndex + 1] : "tempo";

const neonKey = JSON.parse(
  execFileSync("aws", ["ssm", "get-parameter", "--name", "/tempo/dev/neon/api-key", "--with-decryption", "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
).Parameter.Value;

async function neon(path) {
  const response = await fetch(`${NEON_API}${path}`, { headers: { Authorization: `Bearer ${neonKey}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Neon API ${path} → ${response.status}`);
  return response.json();
}

const main = (await neon(`/projects/${NEON_PROJECT_ID}/branches`)).branches.find((b) => b.default);
const { uri } = await neon(
  `/projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${main.id}&database_name=${DATABASE}&role_name=neondb_owner&pooled=false`,
);
const response = await fetch(`https://${new URL(uri).hostname}/sql`, {
  method: "POST",
  headers: { "Neon-Connection-String": uri, "Content-Type": "application/json", "Neon-Batch-Read-Only": "true" },
  body: JSON.stringify({ query: PULSE_SQL, params: [all] }),
});
if (!response.ok) throw new Error(`SQL → ${response.status}`);

console.log(formatPulse((await response.json()).rows));
