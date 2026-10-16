#!/usr/bin/env node
/**
 * Writes the web push VAPID key pair to SSM (docs/30 section 8). Run by a person, once per environment; Claude never
 * writes secrets.
 *
 *   /tempo/<env>/push/vapid-public-key   String        (browsers receive it anyway)
 *   /tempo/<env>/push/vapid-private-key  SecureString  (account default aws/ssm key, no KMS cost)
 *
 * A fresh P-256 pair is made locally with node:crypto. The private key is never printed and reaches the AWS CLI
 * through a temporary file readable only by you, deleted right after, so it is not in the process list.
 *
 * Refuses when either parameter exists, unless `--rotate`. Rotating invalidates every browser subscription: the
 * apps subscribe again on their next start, and until then the worker's sends answer 401/403 and are dropped.
 *
 * Usage:
 *   node tools/scripts/vapid-keys.mjs [--environment dev] [--profile tempo] [--region eu-central-1] [--rotate] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { environment: "dev", profile: "tempo", region: "eu-central-1", rotate: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--environment") args.environment = argv[++i];
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--region") args.region = argv[++i];
    else if (arg === "--rotate") args.rotate = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(args.environment)) throw new Error(`Bad --environment ${args.environment}`);
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

function put(args, name, type, value) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-vapid-"));
  const file = join(dir, "input.json");
  try {
    writeFileSync(file, JSON.stringify({ Name: name, Type: type, Value: value, Overwrite: args.rotate, Tier: "Standard" }), {
      mode: 0o600,
    });
    aws(args, ["ssm", "put-parameter", "--cli-input-json", `file://${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const names = {
  publicKey: `/tempo/${args.environment}/push/vapid-public-key`,
  privateKey: `/tempo/${args.environment}/push/vapid-private-key`,
};

const present = Object.values(names).filter((name) => exists(args, name));
if (present.length > 0 && !args.rotate) {
  console.error(`Already set: ${present.join(", ")}. Nothing changed. Use --rotate to replace the pair.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
const publicValue = point.toString("base64url");
if (point.length !== 65 || publicKey.export({ format: "jwk" }).x !== jwk.x) throw new Error("Unexpected key shape");

if (args.dryRun) {
  console.log(`Dry run: would write ${names.publicKey} and ${names.privateKey}. Public key would be ${publicValue}`);
  process.exit(0);
}

put(args, names.publicKey, "String", publicValue);
put(args, names.privateKey, "SecureString", jwk.d);
console.log(`Wrote ${names.publicKey} and ${names.privateKey}${args.rotate ? " (rotated)" : ""}.`);
console.log(`Public key: ${publicValue}`);
console.log(
  args.rotate
    ? "Running functions keep the old pair until they start cold; redeploy the API and the worker to switch now."
    : "The API and the worker pick the keys up within ten minutes; no deploy needed.",
);
