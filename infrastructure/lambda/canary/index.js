"use strict";
/**
 * The development canary (Wave Q, Q10). EventBridge Scheduler invokes it with
 * { mode: "health" } every 5 minutes and { mode: "deep" } every 60 minutes:
 *   - health: GET /api/v1/health, which never touches the database (Neon Free
 *     has 100 CU-hours a month; a database call every 5 minutes would keep the
 *     compute awake).
 *   - deep: signs in as the smoke-test user (credentials read from SSM at run
 *     time, never logged), then GET /api/v1/me and one tenant read.
 * There is no CloudWatch alarm (development has none: the ten free alarms are
 * pooled across the Organization). Each check keeps its last three results in
 * its own SSM parameter and emails through SNS when two of the three failed, and
 * again when it recovers. { mode: "selftest", fail: true } proves that path
 * with a deliberate 404 without touching the real checks.
 */
const { SSMClient, GetParameterCommand, PutParameterCommand } = require("@aws-sdk/client-ssm");
const { CognitoIdentityProviderClient, AdminInitiateAuthCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const { WINDOW, nextState } = require("./state");
const SELFTEST_FAIL_PATH = "/api/v1/canary-selftest-not-found";

const ssm = new SSMClient({});
const cognito = new CognitoIdentityProviderClient({});
const sns = new SNSClient({});

async function call(path, token) {
  const response = await fetch(`${process.env.API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000)
  });
  if (response.status !== 200) throw new Error(`GET ${path} returned ${response.status}`);
  return response.json();
}

async function health(path) {
  const body = await call(path);
  if (body.status !== "healthy") throw new Error(`GET ${path} reported status ${body.status}`);
  return `healthy, version ${body.version}`;
}

async function parameter(name, decrypt) {
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));
  return result.Parameter.Value;
}

async function deep() {
  const path = process.env.SMOKE_PARAMETER_PATH;
  const auth = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: process.env.USER_POOL_ID,
      ClientId: process.env.CLIENT_ID,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: await parameter(`${path}/email`, false), PASSWORD: await parameter(`${path}/password`, true) }
    })
  );
  const token = auth.AuthenticationResult?.AccessToken;
  if (!token) throw new Error(`sign-in returned a challenge (${auth.ChallengeName ?? "unknown"}) instead of tokens`);
  const me = await call("/api/v1/me", token);
  const studio = me.memberships?.[0]?.organization?.id;
  if (!studio) throw new Error("GET /api/v1/me returned no studio for the smoke-test user");
  const rooms = await call(`/api/v1/organizations/${studio}/rooms`, token);
  return `signed in, me and one tenant read ok (${Array.isArray(rooms.items) ? rooms.items.length : "?"} rooms)`;
}

async function notify(check, state, failures, detail) {
  const prefix = check === "selftest" ? "[self-test] " : "";
  const what = state.alerting ? `FAILING (${failures} of the last ${WINDOW} checks)` : "recovered";
  await sns.send(
    new PublishCommand({
      TopicArn: process.env.TOPIC_ARN,
      Subject: `${prefix}tempo-dev canary: ${check} ${state.alerting ? "failing" : "recovered"}`,
      Message: [
        `Check: ${check} (${process.env.API_URL})`,
        `State: ${what} since ${state.since}`,
        `Last result: ${detail}`,
        `Logs: CloudWatch log group ${process.env.LOG_GROUP}`
      ].join("\n")
    })
  );
}

exports.handler = async (event = {}) => {
  const check = ["deep", "selftest"].includes(event.mode) ? event.mode : "health";
  let ok = true;
  let detail;
  try {
    if (check === "deep") detail = await deep();
    else detail = await health(check === "selftest" && event.fail === true ? SELFTEST_FAIL_PATH : "/api/v1/health");
  } catch (error) {
    ok = false;
    // SDK and fetch messages carry no secret; cut them short anyway.
    detail = String(error?.message ?? error).slice(0, 300);
  }

  const name = `${process.env.STATE_PARAMETER_PREFIX}/${check}`;
  const previous = JSON.parse(await parameter(name, false));
  const { state, changed, failures } = nextState(previous, ok, new Date().toISOString());
  await ssm.send(new PutParameterCommand({ Name: name, Value: JSON.stringify(state), Overwrite: true }));
  if (changed) await notify(check, state, failures, detail);

  console.log(JSON.stringify({ check, ok, detail, failures, alerting: state.alerting, notified: changed }));
  return { check, ok, failures, alerting: state.alerting, notified: changed };
};
