#!/usr/bin/env node
/**
 * Writes one version of the health declaration's data key to SSM (docs/31 section 7, ADR-0026). Run once per
 * environment and key version; the key is never printed, logged or committed.
 *
 *   /tempo/<env>/health/data-key/<version>   SecureString under the account's default aws/ssm key (no KMS cost)
 *
 * 32 random bytes from node:crypto, base64. The value reaches the AWS CLI through a temporary file readable only by
 * you, deleted right after, so it is not in the process list. A version is written once and never overwritten:
 * overwriting would make every declaration encrypted with it unreadable. Rotation writes the next version
 * (`--version 2`), then infrastructure/lib/api/health-parameters.ts names it (docs/31 section 7.1).
 *
 * Usage:
 *   node tools/scripts/health-data-key.mjs [--environment dev] [--version 1] [--profile tempo] [--region eu-central-1] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { environment: "dev", version: "1", profile: "tempo", region: "eu-central-1", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--environment") args.environment = argv[++i];
    else if (arg === "--version") args.version = argv[++i];
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--region") args.region = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(args.environment)) throw new Error(`Bad --environment ${args.environment}`);
  if (!/^[1-9][0-9]{0,2}$/.test(args.version)) throw new Error(`Bad --version ${args.version}`);
  return args;
}

function aws(args, input) {
  return execFileSync("aws", [...input, "--profile", args.profile, "--region", args.region, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function exists(args, name) {
  let found;
  try {
    found = aws(args, ["ssm", "describe-parameters", "--parameter-filters", `Key=Name,Values=${name}`]);
  } catch (error) {
    throw new Error(`Could not read SSM: ${error.stderr ?? error.message}`);
  }
  return JSON.parse(found).Parameters.length > 0;
}

function put(args, name, value) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-health-key-"));
  const file = join(dir, "input.json");
  try {
    writeFileSync(file, JSON.stringify({ Name: name, Type: "SecureString", Value: value, Overwrite: false, Tier: "Standard" }), {
      mode: 0o600,
    });
    aws(args, ["ssm", "put-parameter", "--cli-input-json", `file://${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const name = `/tempo/${args.environment}/health/data-key/${args.version}`;

if (exists(args, name)) {
  console.error(`Already set: ${name}. Nothing changed. A key version is never overwritten; rotate with the next --version.`);
  process.exit(1);
}

if (args.dryRun) {
  console.log(`Dry run: would write ${name} (SecureString, standard tier, aws/ssm).`);
  process.exit(0);
}

put(args, name, randomBytes(32).toString("base64"));
console.log(`Wrote ${name}. The value was not printed.`);
