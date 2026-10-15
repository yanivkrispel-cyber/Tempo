import { AuthClient, type AuthConfig, type Session } from "@tempo/api-client/auth";

export const testAuthConfig: AuthConfig = {
  cognitoDomain: "https://tempo-test.auth.eu-central-1.amazoncognito.com",
  clientId: "test-client",
  redirectUri: "http://localhost:5173/auth/callback",
  logoutUri: "http://localhost:5173/",
};

/** An in-memory Web Storage, so tests never share window.localStorage. */
export function memoryStorage(entries: Record<string, string> = {}): Storage {
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

export function sessionStorageWith(session: Session): Storage {
  return memoryStorage({ "tempo.admin-web.session": JSON.stringify(session) });
}

/** An AuthClient that is already signed in, with a token valid for an hour. */
export function signedInAuth(overrides: Partial<ConstructorParameters<typeof AuthClient>[0]> = {}): AuthClient {
  return new AuthClient({
    config: testAuthConfig,
    app: "admin-web",
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

export function signedOutAuth(overrides: Partial<ConstructorParameters<typeof AuthClient>[0]> = {}): AuthClient {
  return new AuthClient({
    config: testAuthConfig,
    app: "admin-web",
    storage: memoryStorage(),
    flowStorage: memoryStorage(),
    redirect: () => {},
    ...overrides,
  });
}
