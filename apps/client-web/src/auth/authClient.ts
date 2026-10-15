import type { AuthConfig } from "./config";
import { codeChallenge, randomUrlSafe } from "./pkce";

/**
 * Cognito sign-in for a browser app: authorization code with PKCE against the Hosted UI (docs/26 section 2.1).
 *
 * The session (access token, refresh token, expiry) lives in localStorage so the PWA stays signed in for the
 * refresh token's 30 days. The id token is not kept: the API takes access tokens only. The PKCE verifier and
 * `state` live in sessionStorage for the one round trip to the Hosted UI.
 */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface AuthClientOptions {
  config: AuthConfig;
  storage?: Storage;
  flowStorage?: Storage;
  fetch?: typeof globalThis.fetch;
  /** Navigates the browser away (to the Hosted UI). */
  redirect?: (url: string) => void;
  now?: () => number;
}

export class SignInError extends Error {
  constructor(readonly code: "state_mismatch" | "missing_code" | "denied" | "token_exchange_failed", message: string) {
    super(message);
    this.name = "SignInError";
  }
}

const SESSION_KEY = "tempo.client-web.session";
const FLOW_KEY = "tempo.client-web.signin";
/** Refresh this long before the access token expires, so a request never leaves with an expired one. */
const EXPIRY_MARGIN_MS = 60_000;

interface Flow {
  state: string;
  verifier: string;
  returnTo: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export class AuthClient {
  private readonly config: AuthConfig;
  private readonly storage: Storage;
  private readonly flowStorage: Storage;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly redirect: (url: string) => void;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private session: Session | null;
  private refreshing: Promise<string | null> | null = null;
  private completing: { search: string; result: Promise<string> } | null = null;

  constructor(options: AuthClientOptions) {
    this.config = options.config;
    this.storage = options.storage ?? window.localStorage;
    this.flowStorage = options.flowStorage ?? window.sessionStorage;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.redirect = options.redirect ?? ((url) => window.location.assign(url));
    this.now = options.now ?? Date.now;
    this.session = this.readSession();
  }

  get isSignedIn(): boolean {
    return this.session !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends the browser to the Hosted UI. `screen: "signup"` opens the sign-up form instead of sign-in. */
  async signIn(returnTo = "/", screen: "login" | "signup" = "login"): Promise<void> {
    const flow: Flow = { state: randomUrlSafe(), verifier: randomUrlSafe(), returnTo: safeReturnTo(returnTo) };
    this.flowStorage.setItem(FLOW_KEY, JSON.stringify(flow));
    const url = new URL(`${this.config.cognitoDomain}/${screen === "signup" ? "signup" : "oauth2/authorize"}`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: "openid email profile",
      state: flow.state,
      code_challenge_method: "S256",
      code_challenge: await codeChallenge(flow.verifier)
    }).toString();
    this.redirect(url.toString());
  }

  /**
   * Finishes the round trip on `/auth/callback`: checks `state`, swaps the code for tokens. Returns `returnTo`.
   * A second call with the same callback (React StrictMode runs effects twice) gets the first call's result,
   * because the code and the stored flow are single-use.
   */
  completeSignIn(search: string): Promise<string> {
    if (this.completing?.search !== search) this.completing = { search, result: this.exchange(search) };
    return this.completing.result;
  }

  private async exchange(search: string): Promise<string> {
    const params = new URLSearchParams(search);
    const flow = this.takeFlow();
    if (params.get("error")) throw new SignInError("denied", params.get("error_description") ?? params.get("error") ?? "");
    if (!flow || params.get("state") !== flow.state) throw new SignInError("state_mismatch", "The sign-in state does not match.");
    const code = params.get("code");
    if (!code) throw new SignInError("missing_code", "The callback has no authorization code.");

    const tokens = await this.tokenRequest({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: flow.verifier
    });
    if (!tokens?.refresh_token) throw new SignInError("token_exchange_failed", "Cognito did not return tokens.");
    this.setSession(this.toSession(tokens, tokens.refresh_token));
    return flow.returnTo;
  }

  /** A valid access token, refreshed when it is about to expire; null when signed out. */
  async getAccessToken(): Promise<string | null> {
    const session = this.session;
    if (!session) return null;
    if (session.expiresAt - EXPIRY_MARGIN_MS > this.now()) return session.accessToken;
    // One refresh at a time: parallel requests share it.
    this.refreshing ??= this.refresh(session).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Drops the local session, e.g. after the API answered 401. */
  forget(): void {
    this.setSession(null);
  }

  /** Drops the local session and ends the Hosted UI session too, so the next sign-in asks for a password. */
  signOut(): void {
    this.setSession(null);
    const url = new URL(`${this.config.cognitoDomain}/logout`);
    url.search = new URLSearchParams({ client_id: this.config.clientId, logout_uri: this.config.logoutUri }).toString();
    this.redirect(url.toString());
  }

  private async refresh(session: Session): Promise<string | null> {
    const tokens = await this.tokenRequest({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      refresh_token: session.refreshToken
    }).catch(() => null);
    if (!tokens) {
      // Expired or revoked refresh token: signed out.
      this.setSession(null);
      return null;
    }
    // Cognito does not rotate the refresh token unless rotation is turned on; keep the old one if none came back.
    const next = this.toSession(tokens, tokens.refresh_token ?? session.refreshToken);
    this.setSession(next);
    return next.accessToken;
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
    const response = await this.fetchFn(`${this.config.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString()
    });
    if (!response.ok) {
      if (body.grant_type === "authorization_code") {
        throw new SignInError("token_exchange_failed", `Cognito answered ${response.status}.`);
      }
      return null;
    }
    return (await response.json()) as TokenResponse;
  }

  private toSession(tokens: TokenResponse, refreshToken: string): Session {
    return { accessToken: tokens.access_token, refreshToken, expiresAt: this.now() + tokens.expires_in * 1000 };
  }

  private takeFlow(): Flow | null {
    const raw = this.flowStorage.getItem(FLOW_KEY);
    this.flowStorage.removeItem(FLOW_KEY);
    return parse<Flow>(raw, (value) => typeof value.state === "string" && typeof value.verifier === "string");
  }

  private readSession(): Session | null {
    return parse<Session>(
      this.storage.getItem(SESSION_KEY),
      (value) => typeof value.accessToken === "string" && typeof value.refreshToken === "string" && typeof value.expiresAt === "number"
    );
  }

  private setSession(session: Session | null): void {
    const changed = (this.session === null) !== (session === null);
    this.session = session;
    if (session) this.storage.setItem(SESSION_KEY, JSON.stringify(session));
    else this.storage.removeItem(SESSION_KEY);
    if (changed) for (const listener of this.listeners) listener();
  }
}

function parse<T>(raw: string | null, isValid: (value: Record<string, unknown>) => boolean): T | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && isValid(value as Record<string, unknown>) ? (value as T) : null;
  } catch {
    return null;
  }
}

/** Only same-app paths: an open redirect through `returnTo` would let a link send a signed-in user anywhere. */
export function safeReturnTo(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") && !path.startsWith("/auth/") ? path : "/";
}
