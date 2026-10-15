import { accountAdminScope, defaultScopes, type AuthConfig } from "@tempo/api-client/auth";

/**
 * Where the app signs in and which API it calls. Values come from Vite env variables (`.env.example`); none of
 * them is a secret: a browser app client has no client secret, and the bundle ships these values anyway.
 */
export interface AppConfig {
  /** API origin; `""` means the same origin (behind CloudFront). */
  apiUrl: string;
  /** Null when the env variables are missing: the app then shows a setup message instead of a sign-in button. */
  auth: AuthConfig | null;
}

export function readAppConfig(env: ImportMetaEnv = import.meta.env, origin = window.location.origin): AppConfig {
  const cognitoDomain = (env.VITE_COGNITO_DOMAIN ?? "").replace(/\/+$/, "");
  const clientId = env.VITE_COGNITO_CLIENT_ID ?? "";
  // Two-step sign-in setup calls Cognito with the user's token, which needs this scope; the app client must allow it.
  const mfaSetup = env.VITE_COGNITO_MFA_SETUP === "true";
  return {
    apiUrl: (env.VITE_API_URL ?? "").replace(/\/+$/, ""),
    auth:
      cognitoDomain && clientId
        ? {
            cognitoDomain,
            clientId,
            redirectUri: `${origin}/auth/callback`,
            logoutUri: `${origin}/`,
            ...(mfaSetup ? { scopes: [...defaultScopes, accountAdminScope] } : {}),
          }
        : null,
  };
}
