// Shared helpers for the O4 phone run on dev (board #404): the dev API with the smoke owner, fictional Cognito users.
// Never prints passwords, tokens or addresses.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REGION = "eu-central-1";
export const API = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com";
export const APP = "https://tempo-members.pages.dev";
const profile = process.env.E2E_AWS_PROFILE ?? "tempo";

export const aws = (args) =>
  execFileSync("aws", [...args, "--region", REGION, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
export function awsIn(args, input) {
  const dir = mkdtempSync(join(tmpdir(), "tempo-o4-"));
  try {
    const file = join(dir, "i.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    const out = aws([...args, "--cli-input-json", `file://${file}`]);
    return out ? JSON.parse(out) : {};
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const outputs = JSON.parse(aws(["cloudformation", "describe-stacks", "--stack-name", "TempoDev-Identity"])).Stacks[0].Outputs;
const out = (k) => outputs.find((o) => o.OutputKey === k)?.OutputValue;
export const poolId = out("UserPoolId");
export const clientId = out("ClientWebClientId");
const smokePath = out("SmokeTestParameterPath");
const ssm = (n) => JSON.parse(aws(["ssm", "get-parameter", "--name", n, "--with-decryption"])).Parameter.Value;

export const authFor = (username, password) =>
  awsIn(["cognito-idp", "admin-initiate-auth"], {
    UserPoolId: poolId, ClientId: clientId, AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD: password },
  }).AuthenticationResult;
export const smokeToken = () => authFor(ssm(`${smokePath}/email`), ssm(`${smokePath}/password`)).AccessToken;

export async function call(token, method, route, body, { ifMatch } = {}) {
  const r = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(ifMatch === undefined ? {} : { "If-Match": ifMatch }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let json = null;
  try { json = t ? JSON.parse(t) : null; } catch { /* not json */ }
  return { status: r.status, json };
}
export const newPassword = () => `${randomBytes(12).toString("base64url")}aA1!`;
export const confirmUser = (email) => {
  awsIn(["cognito-idp", "admin-confirm-sign-up"], { UserPoolId: poolId, Username: email });
  awsIn(["cognito-idp", "admin-update-user-attributes"], { UserPoolId: poolId, Username: email, UserAttributes: [{ Name: "email_verified", Value: "true" }] });
};
export const deleteUser = (email) => { try { awsIn(["cognito-idp", "admin-delete-user"], { UserPoolId: poolId, Username: email }); } catch { /* gone */ } };
export const localAt = (at) => ({
  localDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(at),
  localStart: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at),
});
export function createUser(email, password) {
  awsIn(["cognito-idp", "admin-create-user"], {
    UserPoolId: poolId, Username: email, MessageAction: "SUPPRESS",
    UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
  });
  awsIn(["cognito-idp", "admin-set-user-password"], { UserPoolId: poolId, Username: email, Password: password, Permanent: true });
}
export function e2eUsers() {
  return JSON.parse(aws(["cognito-idp", "list-users", "--user-pool-id", poolId, "--filter", 'email ^= "e2e-o4-"'])).Users.map((u) => u.Username);
}
