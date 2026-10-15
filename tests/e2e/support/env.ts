import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the suite runs and how it finds the dev environment. Nothing here is a secret: the API URL, the Cognito
 * domain and the browser app client ids ship in every app bundle. The smoke user's password is read only in
 * `credentials.ts`, at sign-in time.
 *
 * Each value comes from an `E2E_*` variable when set, otherwise from AWS (CloudFormation outputs and Cognito) with
 * the profile in `E2E_AWS_PROFILE` (default `tempo`). The resolved values are written back to `process.env`, so
 * the Playwright workers inherit them and do not call AWS again.
 */

export const e2eRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const authDir = join(e2eRoot, ".auth");
/** One browser state for both apps: each keeps its session in its own origin's localStorage. */
export const sessionStatePath = join(authDir, "smoke-user.json");

export const adminUrl = "http://localhost:5173";
export const clientUrl = "http://localhost:5174";

export const environment = process.env.E2E_ENVIRONMENT ?? "dev";
export const region = process.env.E2E_AWS_REGION ?? "eu-central-1";
export const awsProfile = process.env.E2E_AWS_PROFILE ?? "tempo";
/** The only studio the suite touches (data prefixed `e2e-`, removed afterwards). */
export const studioSlug = process.env.E2E_STUDIO_SLUG ?? "tempo-smoke-studio";

export interface AppEnv {
  apiUrl: string;
  cognitoDomain: string;
  adminClientId: string;
  clientClientId: string;
}

/** Runs the AWS CLI and returns trimmed stdout, or null when the CLI is missing or not signed in. */
export function aws(args: string[]): string | null {
  try {
    const out = execFileSync("aws", [...args, "--profile", awsProfile, "--region", region, "--output", "text"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Git Bash rewrites arguments that look like paths (/tempo/dev/...) into Windows paths.
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
      timeout: 30_000,
    }).trim();
    return out && out !== "None" ? out : null;
  } catch {
    return null;
  }
}

function fromAws(): Partial<AppEnv> {
  const prefix = `Tempo${environment.charAt(0).toUpperCase()}${environment.slice(1)}`;
  const output = (stack: string, key: string) =>
    aws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      `${prefix}-${stack}`,
      "--query",
      `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]`,
    ]);

  const apiUrl = output("Api", "HttpApiUrl");
  const poolId = output("Identity", "UserPoolId");
  if (!poolId) return { apiUrl: apiUrl ?? undefined };
  const domain = aws(["cognito-idp", "describe-user-pool", "--user-pool-id", poolId, "--query", "UserPool.Domain"]);
  const client = (name: string) =>
    aws([
      "cognito-idp",
      "list-user-pool-clients",
      "--user-pool-id",
      poolId,
      "--max-results",
      "60",
      "--query",
      `UserPoolClients[?ClientName=='${name}'].ClientId | [0]`,
    ]);
  return {
    apiUrl: apiUrl ?? undefined,
    cognitoDomain: domain ? `https://${domain}.auth.${region}.amazoncognito.com` : undefined,
    adminClientId: client(`tempo-${environment}-admin-web`) ?? undefined,
    clientClientId: client(`tempo-${environment}-client-web`) ?? undefined,
  };
}

/** The dev API and Cognito settings, or null when they are neither in the environment nor readable from AWS. */
export function resolveAppEnv(): AppEnv | null {
  let env: Partial<AppEnv> = {
    apiUrl: process.env.E2E_API_URL,
    cognitoDomain: process.env.E2E_COGNITO_DOMAIN,
    adminClientId: process.env.E2E_ADMIN_CLIENT_ID,
    clientClientId: process.env.E2E_CLIENT_CLIENT_ID,
  };
  if (!env.apiUrl || !env.cognitoDomain || !env.adminClientId || !env.clientClientId) {
    // Already tried in this run (the runner sets this before it forks workers).
    if (process.env.E2E_AWS_LOOKUP_DONE !== "1") {
      const looked = fromAws();
      env = {
        apiUrl: env.apiUrl ?? looked.apiUrl,
        cognitoDomain: env.cognitoDomain ?? looked.cognitoDomain,
        adminClientId: env.adminClientId ?? looked.adminClientId,
        clientClientId: env.clientClientId ?? looked.clientClientId,
      };
      process.env.E2E_AWS_LOOKUP_DONE = "1";
      if (env.apiUrl) process.env.E2E_API_URL = env.apiUrl;
      if (env.cognitoDomain) process.env.E2E_COGNITO_DOMAIN = env.cognitoDomain;
      if (env.adminClientId) process.env.E2E_ADMIN_CLIENT_ID = env.adminClientId;
      if (env.clientClientId) process.env.E2E_CLIENT_CLIENT_ID = env.clientClientId;
    }
  }
  return env.apiUrl && env.cognitoDomain && env.adminClientId && env.clientClientId ? (env as AppEnv) : null;
}

/** The Vite variables for one app's dev server (`apps/<app>/.env.example`). */
export function viteEnv(env: AppEnv | null, app: "admin-web" | "client-web"): Record<string, string> {
  if (!env) return {};
  return {
    VITE_API_URL: env.apiUrl,
    VITE_COGNITO_DOMAIN: env.cognitoDomain,
    VITE_COGNITO_CLIENT_ID: app === "admin-web" ? env.adminClientId : env.clientClientId,
  };
}

/** True when the sign-in setup saved a session for this app; the specs skip with a message otherwise. */
export function hasSession(path: string): boolean {
  return existsSync(path);
}

export const noSessionMessage =
  "No signed-in session: the sign-in setup was skipped or failed. Set E2E_SMOKE_EMAIL and E2E_SMOKE_PASSWORD, or sign in to AWS " +
  "(aws sso login --profile tempo) so the suite can read them from SSM. See tests/e2e/README.md.";
