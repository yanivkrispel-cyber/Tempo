import { createTempoClient, type TempoClient } from "@tempo/api-client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { AuthClient } from "../auth/authClient";

const ApiContext = createContext<TempoClient | null>(null);

export interface ApiProviderProps {
  /** API origin; `""` for the same origin. */
  baseUrl: string;
  auth: AuthClient | null;
  /** Tests pass a stub. */
  fetch?: typeof globalThis.fetch;
  children: ReactNode;
}

/** The typed Tempo API client, carrying the signed-in user's access token. */
export function ApiProvider({ baseUrl, auth, fetch, children }: ApiProviderProps) {
  const [client] = useState(() => {
    const api = createTempoClient({ baseUrl, fetch, getAccessToken: () => auth?.getAccessToken() ?? null });
    api.use({
      onResponse({ request, response }) {
        // A token the API rejects is no use any more: sign out locally so the routes send the user to /login.
        if (response.status === 401 && request.headers.has("Authorization")) auth?.forget();
        return response;
      }
    });
    return api;
  });
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): TempoClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi needs an <ApiProvider>");
  return client;
}
