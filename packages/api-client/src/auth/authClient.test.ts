import { describe, expect, it, vi } from "vitest";
import {
  AuthClient,
  safeReturnTo,
  SignInError,
  type AuthClientOptions,
  type AuthConfig,
  type Session,
} from "./authClient";
import { codeChallenge } from "./pkce";

const testAuthConfig: AuthConfig = {
  cognitoDomain: "https://tempo-test.auth.eu-central-1.amazoncognito.com",
  clientId: "test-client",
  redirectUri: "http://localhost:5174/auth/callback",
  logoutUri: "http://localhost:5174/",
};

/** An in-memory Web Storage. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

const sessionStorageWith = (session: Session) => memoryStorage({ "tempo.client-web.session": JSON.stringify(session) });

function signedInAuth(overrides: Partial<AuthClientOptions> = {}): AuthClient {
  return new AuthClient({
    config: testAuthConfig,
    app: "client-web",
    storage: sessionStorageWith({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
    }),
    flowStorage: memoryStorage(),
    redirect: () => {},
    ...overrides,
  });
}

function signedOutAuth(overrides: Partial<AuthClientOptions> = {}): AuthClient {
  return new AuthClient({
    config: testAuthConfig,
    app: "client-web",
    storage: memoryStorage(),
    flowStorage: memoryStorage(),
    redirect: () => {},
    ...overrides,
  });
}

function tokenResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Starts a sign-in and returns the authorize URL the browser would open. */
async function startSignIn(auth: AuthClient, redirect: ReturnType<typeof vi.fn>, returnTo = "/bookings") {
  await auth.signIn(returnTo);
  return new URL(redirect.mock.calls[0]![0] as string);
}

describe("storage keys", () => {
  it("are named after the app, so two apps on one origin never share a session", async () => {
    const storage = memoryStorage();
    const flowStorage = memoryStorage();
    await new AuthClient({ config: testAuthConfig, app: "admin-web", storage, flowStorage, redirect: () => {} }).signIn(
      "/",
    );
    expect(flowStorage.getItem("tempo.admin-web.signin")).not.toBeNull();
    expect(flowStorage.getItem("tempo.client-web.signin")).toBeNull();
  });
});

describe("pkce", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("AuthClient sign-in", () => {
  it("sends the browser to the Hosted UI with PKCE and state", async () => {
    const redirect = vi.fn();
    const url = await startSignIn(signedOutAuth({ redirect }), redirect);
    expect(url.origin + url.pathname).toBe(`${testAuthConfig.cognitoDomain}/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "test-client",
      redirect_uri: "http://localhost:5174/auth/callback",
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  });

  it("asks for an optional scope only on the sign-in that names it", async () => {
    const redirect = vi.fn();
    const config = { ...testAuthConfig, optionalScopes: ["aws.cognito.signin.user.admin"] };
    const client = new AuthClient({
      config,
      app: "admin-web",
      storage: memoryStorage(),
      flowStorage: memoryStorage(),
      redirect,
    });
    await client.signIn("/");
    await client.signIn("/account/security", "login", { scopes: ["aws.cognito.signin.user.admin", "phone"] });
    const scopeOf = (call: number) => new URL(redirect.mock.calls[call]![0] as string).searchParams.get("scope");
    expect(scopeOf(0)).toBe("openid email profile");
    // "phone" is not declared optional, so it is left out rather than failing the sign-in.
    expect(scopeOf(1)).toBe("openid email profile aws.cognito.signin.user.admin");
  });

  it("never asks for a scope the config does not declare", async () => {
    const redirect = vi.fn();
    const config = { ...testAuthConfig };
    await new AuthClient({
      config,
      app: "admin-web",
      storage: memoryStorage(),
      flowStorage: memoryStorage(),
      redirect,
    }).signIn("/", "login", { scopes: ["aws.cognito.signin.user.admin"] });
    expect(new URL(redirect.mock.calls[0]![0] as string).searchParams.get("scope")).toBe("openid email profile");
  });

  it("asks for the password again through /logout for step-up, keeping PKCE and state", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    await signedInAuth({ redirect, flowStorage }).signIn("/o/neshima", "reauthenticate");
    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/logout");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "test-client",
      redirect_uri: "http://localhost:5174/auth/callback",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")).toBe(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!).state);
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({ returnTo: "/o/neshima" });
  });

  it("keeps returnTo under a studio's own app, whose callback page lives outside it (docs/35 W-4)", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(tokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    const auth = signedOutAuth({ redirect, flowStorage, fetch, basePath: "/s/neshima" });
    const url = await startSignIn(auth, redirect);
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({
      returnTo: "/s/neshima/bookings",
    });
    expect(await auth.completeSignIn(`?code=c0de&state=${url.searchParams.get("state")}`)).toBe("/s/neshima/bookings");

    await auth.signIn("//evil.example");
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({ returnTo: "/s/neshima/" });
  });

  it("opens the sign-up form when asked", async () => {
    const redirect = vi.fn();
    await signedOutAuth({ redirect }).signIn("/", "signup");
    expect(new URL(redirect.mock.calls[0]![0] as string).pathname).toBe("/signup");
  });

  it("swaps the code for tokens with the verifier, stores the session and returns returnTo", async () => {
    const redirect = vi.fn();
    const storage = memoryStorage();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(tokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    const auth = signedOutAuth({ redirect, storage, fetch, now: () => 1_000 });
    const listener = vi.fn();
    auth.subscribe(listener);
    const url = await startSignIn(auth, redirect);

    const returnTo = await auth.completeSignIn(`?code=c0de&state=${url.searchParams.get("state")}`);

    expect(returnTo).toBe("/bookings");
    expect(auth.isSignedIn).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    const [tokenUrl, init] = fetch.mock.calls[0]!;
    expect(tokenUrl).toBe(`${testAuthConfig.cognitoDomain}/oauth2/token`);
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c0de");
    expect(await codeChallenge(body.get("code_verifier")!)).toBe(url.searchParams.get("code_challenge"));
    expect(JSON.parse(storage.getItem("tempo.client-web.session")!)).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 3_601_000,
    });
  });

  it("answers a repeated callback (StrictMode) with the first result instead of a second exchange", async () => {
    const redirect = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(tokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    const auth = signedOutAuth({ redirect, fetch });
    const url = await startSignIn(auth, redirect);
    const search = `?code=c0de&state=${url.searchParams.get("state")}`;

    await expect(Promise.all([auth.completeSignIn(search), auth.completeSignIn(search)])).resolves.toEqual([
      "/bookings",
      "/bookings",
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a callback whose state does not match, without calling Cognito", async () => {
    const redirect = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const auth = signedOutAuth({ redirect, fetch });
    await startSignIn(auth, redirect);

    await expect(auth.completeSignIn("?code=c0de&state=forged")).rejects.toMatchObject({ code: "state_mismatch" });
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.isSignedIn).toBe(false);
  });

  it("reports a cancelled sign-in as denied", async () => {
    const error = await signedOutAuth()
      .completeSignIn("?error=access_denied&state=x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SignInError);
    expect(error).toMatchObject({ code: "denied" });
  });

  it("fails when Cognito refuses the code", async () => {
    const redirect = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(tokenResponse({ error: "invalid_grant" }, 400));
    const auth = signedOutAuth({ redirect, fetch });
    const url = await startSignIn(auth, redirect);
    await expect(auth.completeSignIn(`?code=old&state=${url.searchParams.get("state")}`)).rejects.toMatchObject({
      code: "token_exchange_failed",
    });
  });
});

describe("AuthClient tokens", () => {
  it("adopts tokens from the app's own sign-in screen and tells the listeners", async () => {
    const storage = memoryStorage();
    const auth = signedOutAuth({ storage, now: () => 1_000 });
    const listener = vi.fn();
    auth.subscribe(listener);

    auth.adopt({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 3600 });

    expect(auth.isSignedIn).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem("tempo.client-web.session")!)).toEqual({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: 3_601_000,
    });
    expect(await auth.getAccessToken()).toBe("access-2");
  });

  it("returns the stored access token while it is fresh", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await signedInAuth({ fetch }).getAccessToken()).toBe("access-1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes once for parallel callers when the token is about to expire, keeping the refresh token", async () => {
    const storage = sessionStorageWith({ accessToken: "old", refreshToken: "refresh-1", expiresAt: 30_000 });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(tokenResponse({ access_token: "new", expires_in: 3600 }));
    const auth = signedInAuth({ storage, fetch, now: () => 0 });

    expect(await Promise.all([auth.getAccessToken(), auth.getAccessToken()])).toEqual(["new", "new"]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URLSearchParams(fetch.mock.calls[0]![1]!.body as string).get("grant_type")).toBe("refresh_token");
    expect(JSON.parse(storage.getItem("tempo.client-web.session")!)).toMatchObject({
      accessToken: "new",
      refreshToken: "refresh-1",
    });
  });

  it("signs out when the refresh token is rejected", async () => {
    const storage = sessionStorageWith({ accessToken: "old", refreshToken: "revoked", expiresAt: 0 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(tokenResponse({ error: "invalid_grant" }, 400));
    const auth = signedInAuth({ storage, fetch, now: () => 1 });

    expect(await auth.getAccessToken()).toBeNull();
    expect(auth.isSignedIn).toBe(false);
    expect(storage.getItem("tempo.client-web.session")).toBeNull();
  });

  it("keeps the session when the device is offline, and sends the request without a token", async () => {
    const storage = sessionStorageWith({ accessToken: "old", refreshToken: "refresh-1", expiresAt: 0 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const auth = signedInAuth({ storage, fetch, now: () => 1 });

    expect(await auth.getAccessToken()).toBeNull();
    expect(auth.isSignedIn).toBe(true);
    expect(storage.getItem("tempo.client-web.session")).not.toBeNull();
  });

  it("keeps the session when Cognito answers 5xx", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const auth = signedInAuth({
      storage: sessionStorageWith({ accessToken: "old", refreshToken: "refresh-1", expiresAt: 0 }),
      fetch,
      now: () => 1,
    });

    expect(await auth.getAccessToken()).toBeNull();
    expect(auth.isSignedIn).toBe(true);
  });

  it("revokes the refresh token on sign-out, then ends the Hosted UI session", () => {
    const redirect = vi.fn();
    const storage = sessionStorageWith({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const auth = signedInAuth({ storage, fetch, redirect });
    auth.signOut();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${testAuthConfig.cognitoDomain}/oauth2/revoke`);
    expect(init?.keepalive).toBe(true);
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe("test-client");
    expect(storage.getItem("tempo.client-web.session")).toBeNull();
    expect(new URL(redirect.mock.calls[0]![0] as string).pathname).toBe("/logout");
  });

  it("still signs out when the revoke call fails", () => {
    const redirect = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const auth = signedInAuth({ fetch, redirect });
    auth.signOut();
    expect(auth.isSignedIn).toBe(false);
    expect(redirect).toHaveBeenCalledOnce();
  });

  it("does not call Cognito's revoke when already signed out", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    signedOutAuth({ fetch }).signOut();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a stored session it cannot read", () => {
    const auth = new AuthClient({
      config: testAuthConfig,
      app: "client-web",
      storage: memoryStorage({ "tempo.client-web.session": "{not json" }),
      flowStorage: memoryStorage(),
    });
    expect(auth.isSignedIn).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it.each([
    ["/bookings?x=1", "/bookings?x=1"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/auth/callback", "/"],
    ["bookings", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
