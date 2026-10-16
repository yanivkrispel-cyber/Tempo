import { aws, environment } from "./env";

export interface SmokeUser {
  email: string;
  password: string;
}

/**
 * The dev smoke-test user (docs/claude-memory/backend-patterns.md, "Dev smoke-test user"). From
 * `E2E_SMOKE_EMAIL` and `E2E_SMOKE_PASSWORD` when both are set, otherwise from SSM
 * (`/tempo/<env>/smoke-test/email` and `.../password`, SecureString). Null when neither works.
 *
 * Never log the result. Playwright traces would record the typed password, so the sign-in setup turns tracing off.
 */
export function smokeUser(): SmokeUser | null {
  const fromEnv = { email: process.env.E2E_SMOKE_EMAIL, password: process.env.E2E_SMOKE_PASSWORD };
  if (fromEnv.email && fromEnv.password) return { email: fromEnv.email, password: fromEnv.password };

  const path = process.env.E2E_SMOKE_PARAMETER_PATH ?? `/tempo/${environment}/smoke-test`;
  const parameter = (name: string) =>
    aws(["ssm", "get-parameter", "--name", `${path}/${name}`, "--with-decryption", "--query", "Parameter.Value"]);
  const email = parameter("email");
  const password = email ? parameter("password") : null;
  return email && password ? { email, password } : null;
}
