#!/usr/bin/env node
/**
 * A big studio's database on its own Neon branch (board #511, K4 / S-5): one studio with 1,500 fictional members,
 * 60 classes a week, a year of bookings and attendance, and passes. It measures every query behind the screens of
 * the 2026-10-20 baseline with pg_stat_statements, then the branch is deleted. Nothing touches the main branch.
 *
 *   create  creates the branch from the main branch with its own small read-write endpoint (0.25 CU)
 *   run     runs the harness (`BigStudioPerfTests`, in the sdk:10.0 container): fills the studio once (re-runnable:
 *           a filled branch is not filled again), resets pg_stat_statements, opens every screen's reads three times
 *           as the studio's owner and as a member, and writes the per-query table to tests/e2e/perf/
 *   delete  deletes the branch
 *
 * Every command needs `--branch perf-big-<date>` and refuses the project's main branch. `create` and `run` stop when
 * the project has used 35% of the Free plan's compute for the period. The Neon API key and the role passwords come
 * from SSM and are never printed: the harness gets the connection strings through its environment.
 *
 * Usage:
 *   node tools/scripts/perf-big-db.mjs create|run|delete --branch perf-big-2026-10-25 [--profile tempo]
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computePercent, pickBranch, STOP_PERCENT } from "./lib/perf-big.mjs";
import { waitForOperations as waitForNeonOperations } from "./lib/neon-branch.mjs";

const NEON_API = "https://console.neon.tech/api/v2";
const PROJECT = "wild-darkness-22822656";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const [command, ...rest] = process.argv.slice(2);
const args = { profile: "tempo", region: "eu-central-1" };
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === "--branch") args.branch = rest[++i];
  else if (rest[i] === "--profile") args.profile = rest[++i];
}
if (!["create", "run", "delete"].includes(command)) {
  console.error("usage: perf-big-db.mjs create|run|delete --branch perf-big-<date> [--profile tempo]");
  process.exit(2);
}

function ssm(name) {
  return JSON.parse(
    execFileSync(
      "aws",
      [
        "ssm",
        "get-parameter",
        "--name",
        name,
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
}

const apiKey = ssm("/tempo/dev/neon/api-key");

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

const waitForOperations = (operations) =>
  waitForNeonOperations(
    async (id) => (await neon("GET", `/projects/${PROJECT}/operations/${id}`)).operation,
    operations,
  );

async function stopLine() {
  const { project } = await neon("GET", `/projects/${PROJECT}`);
  const percent = computePercent(project);
  console.log(`Neon compute this period: ${percent.toFixed(1)}% (stop at ${STOP_PERCENT}%)`);
  if (percent >= STOP_PERCENT)
    throw new Error(`compute is at ${percent.toFixed(1)}%, at or over the ${STOP_PERCENT}% stop line`);
}

const { branches } = await neon("GET", `/projects/${PROJECT}/branches`);
const existing = pickBranch(branches, args.branch);

if (command === "create") {
  await stopLine();
  if (existing) {
    console.log(`branch ${existing.name} (${existing.id}) already exists`);
    process.exit(0);
  }
  const main = branches.find((b) => b.default);
  const created = await neon("POST", `/projects/${PROJECT}/branches`, {
    branch: { parent_id: main.id, name: args.branch },
    endpoints: [{ type: "read_write", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25 }],
  });
  await waitForOperations(created.operations);
  console.log(`branch ${created.branch.name} (${created.branch.id}) created from ${main.name}`);
} else if (command === "delete") {
  if (!existing) {
    console.log(`branch ${args.branch} does not exist`);
    process.exit(0);
  }
  const deleted = await neon("DELETE", `/projects/${PROJECT}/branches/${existing.id}`);
  await waitForOperations(deleted.operations);
  console.log(`branch ${existing.name} (${existing.id}) deleted`);
} else {
  await stopLine();
  if (!existing) throw new Error(`branch ${args.branch} does not exist; run create first`);
  const { uri } = await neon(
    "GET",
    `/projects/${PROJECT}/connection_uri?branch_id=${existing.id}&database_name=neondb&role_name=neondb_owner&pooled=false`,
  );
  // Npgsql takes keyword=value strings, not URIs (and echoes a string it can't parse, so never hand it one).
  const host = new URL(uri).hostname;
  const as = (user, password) =>
    `Host=${host};Database=neondb;Username=${user};Password=${password};SSL Mode=Require;Timeout=30`;
  const ownerPassword = decodeURIComponent(new URL(uri).password);
  const env = {
    ...process.env,
    PERF_BIG_OWNER: as("neondb_owner", ownerPassword),
    PERF_BIG_APP: as("tempo_app", ssm("/tempo/dev/db/app-password")),
    PERF_BIG_PLATFORM: as("tempo_platform", ssm("/tempo/dev/db/platform-password")),
    PERF_BIG_MIGRATOR: as("tempo_migrator", ssm("/tempo/dev/db/migrator-password")),
    PERF_BIG_BRANCH: args.branch,
  };
  const out = join(REPO, "tests", "e2e", "perf");
  mkdirSync(out, { recursive: true });
  // The harness runs in the sdk container (Smart App Control blocks locally built test DLLs on this machine);
  // the connection strings reach it by name (-e NAME), never on the command line.
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${REPO}:/src`,
      "-v",
      "tempo-nuget:/root/.nuget/packages",
      "-w",
      "/src",
      ...["PERF_BIG_OWNER", "PERF_BIG_APP", "PERF_BIG_PLATFORM", "PERF_BIG_MIGRATOR", "PERF_BIG_BRANCH"].flatMap(
        (n) => ["-e", n],
      ),
      "mcr.microsoft.com/dotnet/sdk:10.0",
      "dotnet",
      "test",
      "tests/Tempo.IntegrationTests",
      "--filter",
      "FullyQualifiedName~BigStudioPerfTests",
      "--logger",
      "console;verbosity=normal",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  // Whatever the harness prints passes through a mask of the four passwords first.
  const secrets = [
    ownerPassword,
    ...["app", "platform", "migrator"].map(
      (role) => env[`PERF_BIG_${role.toUpperCase()}`].match(/Password=([^;]*)/)[1],
    ),
  ];
  const mask = (chunk) => secrets.reduce((text, secret) => text.split(secret).join("***"), chunk.toString());
  child.stdout.on("data", (chunk) => process.stdout.write(mask(chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(mask(chunk)));
  child.on("close", (code) => process.exit(code ?? 1));
}
