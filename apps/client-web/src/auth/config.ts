/**
 * Where the app signs in and which API it calls. Values come from Vite env variables (`.env.example`); none of
 * them is a secret: a browser app client has no client secret, and the bundle ships these values anyway.
 */
export interface AuthConfig {
  /** The Cognito domain of the customer pool, e.g. `https://tempo-dev-<account>.auth.eu-central-1.amazoncognito.com`. */
  cognitoDomain: string;
  /** The `client-web` app client id. */
  clientId: string;
  /** Must be one of the client's exact callback URLs (`infrastructure/config/<env>.ts`). */
  redirectUri: string;
  /** Must be one of the client's exact logout URLs. */
  logoutUri: string;
}

export interface AppConfig {
  /** API origin; `""` means the same origin (behind CloudFront). */
  apiUrl: string;
  /** Null when the env variables are missing: the app then shows a setup message instead of a sign-in button. */
  auth: AuthConfig | null;
}

export function readAppConfig(env: ImportMetaEnv = import.meta.env, origin = window.location.origin): AppConfig {
  const cognitoDomain = (env.VITE_COGNITO_DOMAIN ?? "").replace(/\/+$/, "");
  const clientId = env.VITE_COGNITO_CLIENT_ID ?? "";
  return {
    apiUrl: (env.VITE_API_URL ?? "").replace(/\/+$/, ""),
    auth: cognitoDomain && clientId
      ? { cognitoDomain, clientId, redirectUri: `${origin}/auth/callback`, logoutUri: `${origin}/` }
      : null
  };
}
