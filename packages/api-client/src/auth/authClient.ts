import { codeChallenge, randomUrlSafe } from "./pkce";

/**
 * Cognito sign-in for a browser app: authorization code with PKCE against the Hosted UI (docs/26 section 2.1).
 *
 * The session (access token, refresh token, expiry) lives in localStorage so the PWA stays signed in for the
 * refresh token's 30 days. The id token is not kept: the API takes access tokens only. The PKCE verifier and
 * `state` live in sessionStorage for the one round trip to the Hosted UI.
 */
/**
 * Where an app signs in. None of it is a secret: a browser app client has no client secret, and the bundle
 * ships these values anyway.
 */
export interface AuthConfig {
  /** The Cognito domain of the pool, e.g. `https://tempo-dev-<account>.auth.eu-central-1.amazoncognito.com`. */
  cognitoDomain: string;
  /** The app client id. */
  clientId: string;
  /** Must be one of the client's exact callback URLs (`infrastructure/config/<env>.ts`). */
  redirectUri: string;
  /** Must be one of the client's exact logout URLs. */
  logoutUri: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface AuthClientOptions {
  config: AuthConfig;
  /** The app's name in the storage keys (`tempo.<app>.session`), e.g. `client-web`. */
  app: string;
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
  private readonly sessionKey: string;
  private readonly flowKey: string;
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
    this.sessionKey = `tempo.${options.app}.session`;
    this.flowKey = `tempo.${options.app}.signin`;
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
    this.flowStorage.setItem(this.flowKey, JSON.stringify(flow));
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

    const response = await this.postToken({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: flow.verifier
    });
    if (!response.ok) throw new SignInError("token_exchange_failed", `Cognito answered ${response.status}.`);
    const tokens = (await response.json()) as TokenResponse;
    if (!tokens.refresh_token) throw new SignInError("token_exchange_failed", "Cognito did not return tokens.");
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
    let response: Response;
    try {
      response = await this.postToken({ grant_type: "refresh_token", client_id: this.config.clientId, refresh_token: session.refreshToken });
    } catch {
      // Offline or a dropped connection: keep the session and send this request without a token.
      return null;
    }
    if (response.status === 400 || response.status === 401) {
      // invalid_grant: the refresh token expired or was revoked. Signed out.
      this.setSession(null);
      return null;
    }
    // Cognito having trouble (5xx): keep the session; the next request tries again.
    if (!response.ok) return null;
    const tokens = (await response.json()) as TokenResponse;
    // Cognito does not rotate the refresh token unless rotation is turned on; keep the old one if none came back.
    const next = this.toSession(tokens, tokens.refresh_token ?? session.refreshToken);
    this.setSession(next);
    return next.accessToken;
  }

  private postToken(body: Record<string, string>): Promise<Response> {
    return this.fetchFn(`${this.config.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString()
    });
  }

  private toSession(tokens: TokenResponse, refreshToken: string): Session {
    return { accessToken: tokens.access_token, refreshToken, expiresAt: this.now() + tokens.expires_in * 1000 };
  }

  private takeFlow(): Flow | null {
    const raw = this.flowStorage.getItem(this.flowKey);
    this.flowStorage.removeItem(this.flowKey);
    return parse<Flow>(raw, (value) => typeof value.state === "string" && typeof value.verifier === "string");
  }

  private readSession(): Session | null {
    return parse<Session>(
      this.storage.getItem(this.sessionKey),
      (value) => typeof value.accessToken === "string" && typeof value.refreshToken === "string" && typeof value.expiresAt === "number"
    );
  }

  private setSession(session: Session | null): void {
    const changed = (this.session === null) !== (session === null);
    this.session = session;
    if (session) this.storage.setItem(this.sessionKey, JSON.stringify(session));
    else this.storage.removeItem(this.sessionKey);
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
