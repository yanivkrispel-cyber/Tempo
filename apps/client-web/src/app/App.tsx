import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthClient } from "@tempo/api-client/auth";
import { useState } from "react";
import { RouterProvider, type createBrowserRouter } from "react-router";
import { ApiProvider } from "../api/ApiProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { ClockProvider } from "../features/member/clock";
import { ToastProvider } from "../shared/design-system";

type Router = ReturnType<typeof createBrowserRouter>;

export interface AppProps {
  router: Router;
  /** Null when sign-in is not configured: /login then shows a setup message. */
  auth: AuthClient | null;
  /** API origin; `""` for the same origin. */
  apiUrl?: string;
  /** Tests pass a stub for the API. */
  fetch?: typeof globalThis.fetch;
  /** The member screens' clock; the device clock by default. Tests pass a fixed moment. */
  now?: Date;
}

export function App({ router, auth, apiUrl = "", fetch, now }: AppProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));

  return (
    <AuthProvider client={auth}>
      <ApiProvider baseUrl={apiUrl} auth={auth} fetch={fetch}>
        <QueryClientProvider client={queryClient}>
          <ClockProvider now={now}>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </ClockProvider>
        </QueryClientProvider>
      </ApiProvider>
    </AuthProvider>
  );
}
