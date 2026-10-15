#!/usr/bin/env node
// eslint-disable-next-line
/**
 * Deployment smoke test (docs/01_AWS_Infrastructure_LLD.md section 38).
 *
 * Verifies, against a real deployed environment:
 *   1. GET /api/v1/health returns 200 with the expected JSON contract.
 *   2. GET /api/v1/me (protected) returns 401 without a token.
 *   3. A smoke-test message sent to the work queue is processed by the worker
 *      Lambda within 60 seconds: the queue reads empty twice in a row and the
 *      DLQ did not grow. Needs AWS CLI credentials that may call
 *      sqs:GetQueueUrl, sqs:SendMessage and sqs:GetQueueAttributes on the
 *      queue, and the first and last of those on its DLQ (the GitHub
 *      deployment role has exactly these). Any failure,
 *      including missing permissions, fails the smoke test; pass
 *      --skip-queue-check to leave this check out deliberately.
 *   4. With --sign-in: signs in as the dev test user (day board #60, decision 5)
 *      and checks that POST /api/v1/session and GET /api/v1/me return 200 for
 *      it. Reads the pool and client ids from cdk-outputs.json (--outputs,
 *      default infrastructure/cdk-outputs.json) and the user from SSM
 *      (<path>/email, <path>/password, path from the Identity stack output
 *      SmokeTestParameterPath). Needs cognito-idp:AdminInitiateAuth and
 *      ssm:GetParameter; CI does not pass --sign-in until the deployment role
 *      has them (a decision for Kris), so today it runs from a developer's
 *      machine with `--profile tempo`.
 *
 * Usage:
 *   node tools/scripts/smoke-test.mjs --api-url https://xxxx.execute-api.eu-central-1.amazonaws.com \
 *     [--environment dev] [--region eu-central-1] [--skip-queue-check]
 *     [--sign-in [--outputs infrastructure/cdk-outputs.json] [--profile tempo]]
 *
 * The API URL may also be supplied via the API_BASE_URL environment
 * variable. Never prints secret values - only status codes, timings and
 * response fields already meant to be public (LLD section 25.3 redaction
 * rules apply here too).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function parseArgs(argv) {
  const args = {
    environment: "dev",
    region: "eu-central-1",
    skipQueueCheck: false,
    signIn: false,
    outputs: "infrastructure/cdk-outputs.json"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api-url") args.apiUrl = argv[++i];
    else if (arg === "--environment") args.environment = argv[++i];
    else if (arg === "--region") args.region = argv[++i];
    else if (arg === "--skip-queue-check") args.skipQueueCheck = true;
    else if (arg === "--sign-in") args.signIn = true;
    else if (arg === "--outputs") args.outputs = argv[++i];
    else if (arg === "--profile") args.profile = argv[++i];
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

let awsProfile;

function awsCli(args) {
  const withProfile = awsProfile ? [...args, "--profile", awsProfile] : args;
  return execFileSync("aws", withProfile, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Messages visible plus in flight. */
function queueDepth(queueUrl, region) {
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
  return Number(attributes.ApproximateNumberOfMessages) + Number(attributes.ApproximateNumberOfMessagesNotVisible);
}

async function checkQueueIsDrained(environment, region) {
  const queueName = `tempo-${environment}-work`;
  console.log(`→ sending a smoke-test message to ${queueName}`);

  let queueUrl;
  let dlqUrl;
  let dlqBefore;
  try {
    queueUrl = JSON.parse(
      awsCli(["sqs", "get-queue-url", "--queue-name", queueName, "--region", region])
    ).QueueUrl;
    dlqUrl = JSON.parse(
      awsCli(["sqs", "get-queue-url", "--queue-name", `${queueName}-dlq`, "--region", region])
    ).QueueUrl;
    dlqBefore = queueDepth(dlqUrl, region);
    const marker = `smoke-test-${Date.now()}`;
    // The worker routes on the MessageType attribute; an untyped message would be dead-lettered.
    const attributes = JSON.stringify({ MessageType: { DataType: "String", StringValue: "smoke-test" } });
    awsCli([
      "sqs",
      "send-message",
      "--queue-url",
      queueUrl,
      "--message-body",
      marker,
      "--message-attributes",
      attributes,
      "--region",
      region
    ]);
  } catch (error) {
    // A missing queue or missing permission is a broken deployment, not a reason to skip.
    fail(`could not send a test message to ${queueName} (${error.message.trim()})`);
    return false;
  }

  // The worker's event source mapping long-polls the queue. A message counts
  // as drained when it is neither visible nor in flight. SQS counts are
  // approximate and can read 0 for a moment right after a send (on 2026-10-14
  // a worker that could not start passed this way), so the queue must read
  // empty twice in a row, and a message that went to the DLQ is a failure.
  const deadline = Date.now() + 60_000;
  let remaining = Number.NaN;
  let emptyReads = 0;
  while (Date.now() < deadline) {
    await sleep(5_000);
    remaining = queueDepth(queueUrl, region);
    emptyReads = remaining === 0 ? emptyReads + 1 : 0;
    if (emptyReads === 2) {
      const dlqAfter = queueDepth(dlqUrl, region);
      if (dlqAfter > dlqBefore) {
        fail(`the smoke-test message went to ${queueName}-dlq (${dlqBefore} -> ${dlqAfter}) - the worker failed to process it`);
        return false;
      }
      console.log("✓ smoke-test message on the work queue was processed by the worker Lambda");
      return true;
    }
  }

  fail(`${remaining} message(s) still on ${queueName} after 60s - the worker did not process the test message`);
  return false;
}

function ssmValue(name, region) {
  return JSON.parse(
    awsCli(["ssm", "get-parameter", "--name", name, "--with-decryption", "--region", region])
  ).Parameter.Value;
}

async function callApi(apiUrl, method, path, token) {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  console.log(`→ ${method} ${url} (test user)`);
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000)
  });
  console.log(`  status=${response.status}`);
  return response;
}

async function checkSignedInSession(apiUrl, environment, region, outputsPath) {
  let token;
  try {
    const outputs = JSON.parse(readFileSync(outputsPath, "utf8"));
    const identity = outputs[`Tempo${environment[0].toUpperCase()}${environment.slice(1)}-Identity`] ?? {};
    const { UserPoolId: userPoolId, ClientWebClientId: clientId, SmokeTestParameterPath: path } = identity;
    if (!userPoolId || !clientId || !path) {
      fail(`${outputsPath} has no UserPoolId, ClientWebClientId and SmokeTestParameterPath for the Identity stack`);
      return false;
    }
    const email = ssmValue(`${path}/email`, region);
    const password = ssmValue(`${path}/password`, region);
    // The password goes through a private temp file, never the command line: a failed call's error message and
    // the process list both show the command line.
    const dir = mkdtempSync(join(tmpdir(), "tempo-smoke-"));
    const input = join(dir, "auth.json");
    let auth;
    try {
      writeFileSync(
        input,
        JSON.stringify({
          UserPoolId: userPoolId,
          ClientId: clientId,
          AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
          AuthParameters: { USERNAME: email, PASSWORD: password }
        }),
        { mode: 0o600 }
      );
      auth = JSON.parse(
        awsCli(["cognito-idp", "admin-initiate-auth", "--cli-input-json", `file://${input}`, "--region", region])
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    token = auth.AuthenticationResult?.AccessToken;
    if (!token) {
      fail(`the test user got a challenge instead of tokens (${auth.ChallengeName ?? "unknown"})`);
      return false;
    }
  } catch (error) {
    // Only the CLI's stderr: execFileSync's error.message starts with the full command line.
    const reason = error.stderr?.toString().trim().split("\n")[0] || error.code || "unknown error";
    fail(`could not sign in the test user (${reason})`);
    return false;
  }

  const session = await callApi(apiUrl, "POST", "/api/v1/session", token);
  if (session.status !== 200) {
    fail(`expected HTTP 200 from POST /api/v1/session, got ${session.status}`);
    return false;
  }
  const me = await callApi(apiUrl, "GET", "/api/v1/me", token);
  if (me.status !== 200) {
    fail(`expected HTTP 200 from GET /api/v1/me, got ${me.status}`);
    return false;
  }
  const body = await me.json();
  if (!body.id || !Array.isArray(body.memberships)) {
    fail("GET /api/v1/me did not return an account with memberships");
    return false;
  }
  console.log(`✓ signed-in session: account ${body.id}, ${body.memberships.length} studio(s)`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  awsProfile = args.profile;

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

  let signInOk = true;
  if (args.signIn) {
    signInOk = await checkSignedInSession(args.apiUrl, args.environment, args.region, args.outputs);
  }

  if (healthOk && authOk && queueOk && signInOk) {
    console.log("\n✓ SMOKE TEST PASSED\n");
  }
}

await main();
