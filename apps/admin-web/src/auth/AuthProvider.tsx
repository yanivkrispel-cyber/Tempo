import type { AuthClient } from "@tempo/api-client/auth";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

interface AuthState {
  /** Null when the app has no sign-in configuration (`.env.example`). */
  client: AuthClient | null;
  isSignedIn: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const noSubscription = () => () => {};

export function AuthProvider({ client, children }: { client: AuthClient | null; children: ReactNode }) {
  const isSignedIn = useSyncExternalStore(
    client ? (listener) => client.subscribe(listener) : noSubscription,
    () => client?.isSignedIn ?? false
  );
  return <AuthContext.Provider value={{ client, isSignedIn }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth needs an <AuthProvider>");
  return state;
}
