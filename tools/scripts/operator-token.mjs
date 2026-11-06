#!/usr/bin/env node
/**
 * Signs a person in as a Tempo operator and runs ONE command with the fresh access token in TEMPO_OPERATOR_TOKEN
 * (board #584, K5). The token never reaches the screen, a file or a command line, and it lives 15 minutes.
 *
 * There is no operator app yet, so this uses the operator app client's own Hosted UI sign-in (authorization code with
 * PKCE) and its registered callback, http://localhost:5175/auth/callback: the browser opens the sign-in page, the
 * person signs in (with their TOTP code where MFA is set), and Cognito sends the browser back to this script.
 *
 * Usage (a person, never an agent; AWS CLI signed in with `--profile tempo`):
 *   node tools/scripts/operator-token.mjs [--env dev] [--profile tempo] -- node tools/scripts/e2e-cleanup.mjs --apply
 *   node tools/scripts/operator-token.mjs --url-only      # print the sign-in address and stop (a check, no sign-in)
 */

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const REGION = "eu-central-1";
const PORT = 5175;
const CALLBACK = `http://localhost:${PORT}/auth/callback`;

const argv = process.argv.slice(2);
const dashDash = argv.indexOf("--");
const own = dashDash >= 0 ? argv.slice(0, dashDash) : argv;
const command = dashDash >= 0 ? argv.slice(dashDash + 1) : [];
const option = (name, fallback) => (own.includes(name) ? own[own.indexOf(name) + 1] : fallback);
const environment = option("--env", "dev");
const profile = option("--profile", "tempo");
const urlOnly = own.includes("--url-only");

if (!urlOnly && command.length === 0) {
  console.error("Give the command to run after --, for example: -- node tools/scripts/e2e-cleanup.mjs --apply");
  process.exit(2);
}

const aws = (cliArgs) =>
  JSON.parse(execFileSync("aws", [...cliArgs, "--region", REGION, "--profile", profile, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));

const poolName = `tempo-${environment}-operators`;
const pool = aws(["cognito-idp", "list-user-pools", "--max-results", "60"]).UserPools.find((p) => p.Name === poolName);
if (!pool) throw new Error(`User pool ${poolName} not found.`);
const domain = aws(["cognito-idp", "describe-user-pool", "--user-pool-id", pool.Id]).UserPool.Domain;
const client = aws(["cognito-idp", "list-user-pool-clients", "--user-pool-id", pool.Id]).UserPoolClients.find((c) => c.ClientName.endsWith("-operators-platform-admin-web"));
if (!domain || !client) throw new Error(`The ${poolName} pool has no Hosted UI domain or no operator app client.`);
const base = `https://${domain}.auth.${REGION}.amazoncognito.com`;

const base64url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = base64url(randomBytes(32));
const state = base64url(randomBytes(16));
const authorize = new URL(`${base}/oauth2/authorize`);
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: client.ClientId,
  redirect_uri: CALLBACK,
  scope: "openid email profile",
  state,
  code_challenge: base64url(createHash("sha256").update(verifier).digest()),
  code_challenge_method: "S256",
}).toString();

if (urlOnly) {
  console.log(authorize.toString());
  process.exit(0);
}

const code = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", CALLBACK);
    if (url.pathname !== "/auth/callback") {
      response.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
    response.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(ok ? "Signed in. You can close this tab and go back to the terminal." : "The sign-in did not come back right. Run the script again.");
    server.close();
    if (ok) resolve(url.searchParams.get("code"));
    else reject(new Error(`Sign-in failed: ${url.searchParams.get("error") ?? "state mismatch"}`));
  });
  server.on("error", (error) => reject(new Error(`Port ${PORT} is busy (${error.code}); close what uses it and run again.`)));
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Opening the operator sign-in (${poolName}) in the browser. If it doesn't open, paste this address:\n${authorize}\n`);
    const opener = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", authorize.toString()]] : [process.platform === "darwin" ? "open" : "xdg-open", [authorize.toString()]];
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
  });
  setTimeout(() => {
    server.close();
    reject(new Error("No sign-in within 5 minutes."));
  }, 5 * 60 * 1000).unref();
});

const tokenResponse = await fetch(`${base}/oauth2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.ClientId, code, redirect_uri: CALLBACK, code_verifier: verifier }),
});
if (!tokenResponse.ok) throw new Error(`The token exchange failed (${tokenResponse.status}).`);
const { access_token: token } = await tokenResponse.json();
console.log(`Signed in as an operator (token length ${token.length}). Running: ${command.join(" ")}\n`);

// No shell: the arguments reach the command as given. On Windows, spawn finds an .exe such as node on the PATH by
// itself; a .cmd script needs its full path.
const child = spawn(command[0], command.slice(1), { stdio: "inherit", env: { ...process.env, TEMPO_OPERATOR_TOKEN: token } });
child.on("error", (error) => {
  console.error(`Could not start ${command[0]}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (exitCode) => process.exit(exitCode ?? 1));
