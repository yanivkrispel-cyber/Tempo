#!/usr/bin/env node
// eslint-disable-next-line
/**
 * Deployment smoke test (docs/01_AWS_Infrastructure_LLD.md section 38).
 *
 * Verifies, against a real deployed environment:
 *   1. GET /api/v1/health returns 200 with the expected JSON contract.
 *   2. GET /api/v1/me (protected) returns 401 without a token.
 *   3. A message sent to the smoke-test SQS queue is drained by the worker
 *      Lambda within 60 seconds. Needs AWS CLI credentials that may call
 *      sqs:GetQueueUrl, sqs:SendMessage and sqs:GetQueueAttributes on that
 *      queue (the GitHub deployment role has exactly these). Any failure,
 *      including missing permissions, fails the smoke test; pass
 *      --skip-queue-check to leave this check out deliberately.
 *
 * Usage:
 *   node tools/scripts/smoke-test.mjs --api-url https://xxxx.execute-api.eu-central-1.amazonaws.com \
 *     [--environment dev] [--region eu-central-1] [--skip-queue-check]
 *
 * The API URL may also be supplied via the API_BASE_URL environment
 * variable. Never prints secret values - only status codes, timings and
 * response fields already meant to be public (LLD section 25.3 redaction
 * rules apply here too).
 */

import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function parseArgs(argv) {
  const args = { environment: "dev", region: "eu-central-1", skipQueueCheck: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api-url") args.apiUrl = argv[++i];
    else if (arg === "--environment") args.environment = argv[++i];
    else if (arg === "--region") args.region = argv[++i];
    else if (arg === "--skip-queue-check") args.skipQueueCheck = true;
  }
  args.apiUrl ??= process.env.API_BASE_URL;
  return args;
}

function fail(message) {
  console.error(`\n✗ SMOKE TEST FAILED: ${message}\n`);
  process.exitCode = 1;
}

async function checkHealth(apiUrl) {
  const url = `${apiUrl.replace(/\/$/, "")}/api/v1/health`;
  console.log(`→ GET ${url}`);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    fail(`could not reach the health endpoint (${error.message}). Is the environment deployed?`);
    return false;
  }

  const correlationId = response.headers.get("x-correlation-id");
  console.log(`  status=${response.status} correlationId=${correlationId ?? "(none)"}`);

  if (response.status !== 200) {
    fail(`expected HTTP 200 from /api/v1/health, got ${response.status}`);
    return false;
  }

  const body = await response.json();
  const requiredFields = ["status", "environment", "version", "timestamp", "correlationId"];
  const missing = requiredFields.filter((field) => !(field in body));
  if (missing.length > 0) {
    fail(`health response is missing required field(s): ${missing.join(", ")}`);
    return false;
  }

  if (body.status !== "healthy") {
    fail(`expected status "healthy", got "${body.status}"`);
    return false;
  }

  if (Number.isNaN(Date.parse(body.timestamp))) {
    fail(`timestamp "${body.timestamp}" is not a valid ISO-8601 UTC timestamp`);
    return false;
  }

  console.log(`✓ health: environment=${body.environment} version=${body.version}`);
  return true;
}

async function checkUnauthenticatedMeIsRejected(apiUrl) {
  const url = `${apiUrl.replace(/\/$/, "")}/api/v1/me`;
  console.log(`→ GET ${url} (no token)`);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    fail(`could not reach /api/v1/me (${error.message})`);
    return false;
  }

  console.log(`  status=${response.status}`);

  if (response.status !== 401) {
    fail(`expected HTTP 401 from unauthenticated /api/v1/me, got ${response.status}`);
    return false;
  }

  console.log("✓ unauthenticated /api/v1/me correctly rejected with 401");
  return true;
}

function awsCli(args) {
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function checkQueueIsDrained(environment, region) {
  const queueName = `tempo-${environment}-smoke-test`;
  console.log(`→ sending a test message to ${queueName}`);

  let queueUrl;
  try {
    queueUrl = JSON.parse(
      awsCli(["sqs", "get-queue-url", "--queue-name", queueName, "--region", region])
    ).QueueUrl;
    const marker = `smoke-test-${Date.now()}`;
    awsCli(["sqs", "send-message", "--queue-url", queueUrl, "--message-body", marker, "--region", region]);
  } catch (error) {
    // A missing queue or missing permission is a broken deployment, not a reason to skip.
    fail(`could not send a test message to ${queueName} (${error.message.trim()})`);
    return false;
  }

  // The worker's event source mapping long-polls the queue. A message counts
  // as drained when it is neither visible nor in flight; a cold start can take
  // several seconds, so poll for up to a minute.
  const deadline = Date.now() + 60_000;
  let remaining = Number.NaN;
  while (Date.now() < deadline) {
    await sleep(5_000);
    const attributes = JSON.parse(
      awsCli([
        "sqs",
        "get-queue-attributes",
        "--queue-url",
        queueUrl,
        "--attribute-names",
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
        "--region",
        region
      ])
    ).Attributes;
    remaining = Number(attributes.ApproximateNumberOfMessages) + Number(attributes.ApproximateNumberOfMessagesNotVisible);
    if (remaining === 0) {
      console.log("✓ smoke-test queue message was drained by the worker Lambda");
      return true;
    }
  }

  fail(`${remaining} message(s) still on ${queueName} after 60s - the worker did not process the test message`);
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.apiUrl) {
    fail("no API URL provided - pass --api-url or set API_BASE_URL");
    return;
  }

  const healthOk = await checkHealth(args.apiUrl);
  if (!healthOk) {
    // The endpoint itself is unreachable/broken - further checks would only
    // repeat the same failure.
    return;
  }

  const authOk = await checkUnauthenticatedMeIsRejected(args.apiUrl);

  let queueOk = true;
  if (!args.skipQueueCheck) {
    queueOk = await checkQueueIsDrained(args.environment, args.region);
  }

  if (healthOk && authOk && queueOk) {
    console.log("\n✓ SMOKE TEST PASSED\n");
  }
}

await main();
