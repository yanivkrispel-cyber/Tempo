import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { adminUrl, aws, environment } from "./env";

/**
 * Fresh e2e logins for a spec that needs its own owner and staff (as SYNC 6 does inline): Cognito users made with the
 * admin API (`e2e-…@example.com`, a random password that lives only in memory), the Hosted UI sign-in, and calls to
 * the dev API with the token a page's app keeps.
 */
export interface User {
  email: string;
  password: string;
}

export function newUser(prefix: string, role: string, run: string): User {
  return {
    email: `e2e-${prefix}-${role}-${run}@example.com`,
    password: `Aa1!${randomBytes(18).toString("base64url")}`,
  };
}

/** The dev user pool's id from CloudFormation, or "" when AWS isn't signed in. */
export function userPoolId(): string {
  const stack = `Tempo${environment.charAt(0).toUpperCase()}${environment.slice(1)}-Identity`;
  return (
    aws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stack,
      "--query",
      "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]",
    ]) ?? ""
  );
}

/** The Cognito CLI with its input in a temporary file, so a password never appears on a command line. */
function cognito(command: string, input: Record<string, unknown>): string | null {
  const dir = mkdtempSync(join(tmpdir(), "tempo-e2e-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return aws(["cognito-idp", command, "--cli-input-json", `file://${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const userExists = (poolId: string, user: User) =>
  cognito("admin-get-user", { UserPoolId: poolId, Username: user.email }) !== null;

export function createUser(poolId: string, user: User) {
  cognito("admin-create-user", {
    UserPoolId: poolId,
    Username: user.email,
    MessageAction: "SUPPRESS",
    UserAttributes: [
      { Name: "email", Value: user.email },
      { Name: "email_verified", Value: "true" },
    ],
  });
  cognito("admin-set-user-password", {
    UserPoolId: poolId,
    Username: user.email,
    Password: user.password,
    Permanent: true,
  });
  if (!userExists(poolId, user)) throw new Error(`Could not create the Cognito user ${user.email}.`);
}

export function deleteUser(poolId: string, user: User): boolean {
  if (!poolId || !userExists(poolId, user)) return false;
  cognito("admin-delete-user", { UserPoolId: poolId, Username: user.email });
  return true;
}

/** The Hosted UI's form, when it shows one: a page that still has a Cognito session goes straight back. */
export async function hostedUi(page: Page, user: User, app: string) {
  // Two copies of the form when the Hosted UI's CSS is late (see auth.setup.ts): wait for one, use the first shown.
  const form = page.locator('input[name="username"]:visible').first();
  const back = (url: URL) => url.origin === app && !url.pathname.startsWith("/auth/") && url.pathname !== "/login";
  // Whichever comes first; the other wait is dropped, so its timeout must not fail the test later.
  const shown = form.waitFor({ timeout: 30_000 });
  const returned = page.waitForURL(back, { timeout: 30_000 });
  shown.catch(() => undefined);
  returned.catch(() => undefined);
  await Promise.race([shown, returned]);
  if (await form.isVisible()) {
    const shownForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="username"]:visible') })
      .first();
    await shownForm.locator('input[name="username"]').fill(user.email);
    await shownForm.locator('input[name="password"]').fill(user.password);
    await shownForm.locator('input[name="signInSubmitButton"]').click();
  }
  await page.waitForURL(back, { timeout: 30_000 });
}

export async function signIn(page: Page, app: string, user: User) {
  await page.goto(`${app}/login`);
  await page.getByRole("button", { name: "התחברות" }).click();
  await hostedUi(page, user, app);
}

/** A call to the dev API with the access token the page's app keeps (`tempo.<app>.session`). */
export async function call<T = unknown>(
  page: Page,
  method: string,
  path: string,
  options: { data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const app = new URL(page.url()).origin === adminUrl ? "admin-web" : "client-web";
  const raw = await page.evaluate((key) => localStorage.getItem(key), `tempo.${app}.session`);
  const token = (JSON.parse(raw ?? "{}") as { accessToken?: string }).accessToken ?? "";
  const response = await page.request.fetch(`${process.env.E2E_API_URL}/api/v1${path}`, {
    method,
    data: options.data,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : undefined) as T };
}

/** A call that must succeed, failing the test with the API's answer otherwise. */
export async function ok<T = unknown>(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const answer = await call<T>(page, method, path, { data, headers });
  expect(answer.status, `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBeLessThan(
    300,
  );
  return answer.body;
}
