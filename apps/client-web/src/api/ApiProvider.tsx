import { createTempoClient, isProblem, type TempoClient } from "@tempo/api-client";
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
      async onResponse({ request, response }) {
        // A token the API rejects is no use any more: sign out locally so the routes send the user to /login.
        // Not for a request that went without a token, and not when the API asks for a fresh sign-in for one
        // privileged action (auth.step_up_required, docs/27 section 3.6): that keeps the session.
        const sentToken = request.headers.has("Authorization") || request.headers.has("X-Tempo-Authorization");
        if (response.status === 401 && sentToken && (await problemCode(response)) !== "auth.step_up_required") auth?.forget();
        return response;
      }
    });
    return api;
  });
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

async function problemCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    return isProblem(body) ? body.code : null;
  } catch {
    return null;
  }
}

export function useApi(): TempoClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi needs an <ApiProvider>");
  return client;
}
