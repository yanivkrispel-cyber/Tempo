#!/usr/bin/env node
/**
 * Neon restore drill (night board #136, B2; docs/01 section 28 "a restore drill before the first paying studio").
 *
 * Proves that a point-in-time restore of the environment's Neon project works and measures it:
 *   1. Reads the project: plan, history retention (the restore window), the main branch.
 *   2. Creates a branch from the main branch as it was `--minutes-ago` minutes ago (default 30), with a read-only
 *      endpoint, and waits for Neon to finish.
 *   3. Runs the same checks on the restored branch and on the main branch over Neon's SQL-over-HTTP endpoint:
 *      the migration journal (`platform.schema_versions`) and row counts of the tenant tables.
 *   4. Deletes the drill branch. Nothing on the main branch changes.
 *
 * The Neon API key comes from SSM `/tempo/<env>/neon/api-key` (the usage-check Lambda's parameter) and is never
 * printed; connection strings stay in memory. Needs `--profile tempo` rights for ssm:GetParameter.
 *
 * Usage:
 *   node tools/scripts/neon-restore-drill.mjs [--environment dev] [--project <neon project id>]
 *                                            [--minutes-ago 30] [--profile tempo] [--keep]
 */

import { execFileSync } from "node:child_process";

const NEON_API = "https://console.neon.tech/api/v2";
const DEFAULT_PROJECT = { dev: "wild-darkness-22822656" };
const TABLES = [
  "organizations.organizations",
  "organizations.memberships",
  "organizations.invitations",
  "people.people",
  "scheduling.templates",
  "scheduling.sessions",
  "scheduling.bookings",
  "scheduling.passes",
  "notifications.inbox_items",
  "billing.subscriptions",
  "audit.audit_events",
];

function parseArgs(argv) {
  const args = { environment: "dev", minutesAgo: 30, profile: "tempo", keep: false, region: "eu-central-1" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--environment") args.environment = argv[++i];
    else if (arg === "--project") args.project = argv[++i];
    else if (arg === "--minutes-ago") args.minutesAgo = Number(argv[++i]);
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--region") args.region = argv[++i];
    else if (arg === "--keep") args.keep = true;
  }
  args.project ??= DEFAULT_PROJECT[args.environment];
  if (!args.project) throw new Error(`no Neon project known for environment ${args.environment}; pass --project`);
  return args;
}

const args = parseArgs(process.argv.slice(2));

const apiKey = JSON.parse(
  execFileSync(
    "aws",
    [
      "ssm",
      "get-parameter",
      "--name",
      `/tempo/${args.environment}/neon/api-key`,
      "--with-decryption",
      "--region",
      args.region,
      "--profile",
      args.profile,
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
).Parameter.Value;

async function neon(method, path, body) {
  const response = await fetch(`${NEON_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Neon API ${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Neon's SQL-over-HTTP endpoint: one statement, the connection string in a header, never on the command line. */
async function sql(connectionUri, query) {
  const host = new URL(connectionUri).hostname;
  const response = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: { "Neon-Connection-String": connectionUri, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`SQL on ${host} → ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.rows;
}

async function waitForOperations(operations) {
  for (const op of operations ?? []) {
    for (let tries = 0; tries < 60; tries += 1) {
      const { operation } = await neon("GET", `/projects/${args.project}/operations/${op.id}`);
      if (operation.status === "finished") break;
      if (operation.status === "failed" || operation.status === "error")
        throw new Error(`operation ${op.action} ${operation.status}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function connectionUri(branchId) {
  const { uri } = await neon(
    "GET",
    `/projects/${args.project}/connection_uri?branch_id=${branchId}&database_name=neondb&role_name=neondb_owner&pooled=false`,
  );
  return uri;
}

async function inspect(label, uri) {
  const started = Date.now();
  const journal = await sql(
    uri,
    "SELECT count(*)::int AS applied, max(script_name) AS last FROM platform.schema_versions",
  );
  const counts = {};
  for (const table of TABLES) {
    const rows = await sql(uri, `SELECT count(*)::int AS n FROM ${table}`).catch(() => null);
    counts[table] = rows ? rows[0].n : "missing";
  }
  console.log(
    `\n${label}: ${journal[0].applied} migrations applied, last ${journal[0].last} (${Date.now() - started} ms)`,
  );
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(34)} ${n}`);
  return { journal: journal[0], counts };
}

const drillStart = Date.now();
const { project } = await neon("GET", `/projects/${args.project}`);
const retentionHours = project.history_retention_seconds / 3600;
console.log(`project ${project.name} (${project.id}), PostgreSQL ${project.pg_version}, region ${project.region_id}`);
console.log(`restore window (history retention): ${retentionHours} h; the drill restores ${args.minutesAgo} min back`);
if (args.minutesAgo * 60 > project.history_retention_seconds)
  throw new Error("the requested point is outside the restore window");

const { branches } = await neon("GET", `/projects/${args.project}/branches`);
const main = branches.find((b) => b.default) ?? branches.find((b) => b.name === "production");
if (!main) throw new Error("no default branch found");

const timestamp = new Date(Date.now() - args.minutesAgo * 60_000).toISOString();
const name = `restore-drill-${timestamp.replace(/[:.]/g, "-")}`;
console.log(`\ncreating branch ${name} from ${main.name} as of ${timestamp} ...`);
const createdAt = Date.now();
const created = await neon("POST", `/projects/${args.project}/branches`, {
  branch: { parent_id: main.id, parent_timestamp: timestamp, name },
  endpoints: [{ type: "read_only" }],
});
await waitForOperations(created.operations);
const branchReadyMs = Date.now() - createdAt;
console.log(`branch ready in ${branchReadyMs} ms`);

let exitCode = 0;
try {
  const restored = await inspect("restored branch", await connectionUri(created.branch.id));
  const live = await inspect("main branch (now)", await connectionUri(main.id));
  const sameJournal = restored.journal.applied === live.journal.applied && restored.journal.last === live.journal.last;
  console.log(`\n${sameJournal ? "✓" : "✗"} the restored branch carries the same migrations as main`);
  const drifted = Object.keys(live.counts).filter((t) => live.counts[t] !== restored.counts[t]);
  console.log(
    `${drifted.length === 0 ? "✓" : "·"} row counts ${drifted.length === 0 ? "identical" : `differ in ${drifted.join(", ")} (changes since the restore point)`}`,
  );
  if (!sameJournal) exitCode = 1;
} finally {
  if (args.keep) {
    console.log(`\nkeeping branch ${created.branch.id}; delete it yourself (it counts toward storage)`);
  } else {
    const deleted = await neon("DELETE", `/projects/${args.project}/branches/${created.branch.id}`);
    await waitForOperations(deleted.operations);
    console.log(`\nbranch deleted`);
  }
}

console.log(
  `\nRESTORE DRILL ${exitCode === 0 ? "PASSED" : "FAILED"}: window ${retentionHours} h, branch ready in ${(branchReadyMs / 1000).toFixed(1)} s, whole drill ${((Date.now() - drillStart) / 1000).toFixed(1)} s`,
);
process.exit(exitCode);
