import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthClient } from "@tempo/api-client/auth";
import { useState } from "react";
import { RouterProvider, type createBrowserRouter } from "react-router";
import { ApiProvider } from "../api/ApiProvider";
import { AuthProvider } from "../auth/AuthProvider";
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
  /** Tests pass one to look into the cache. */
  queryClient?: QueryClient;
}

export function App({ router, auth, apiUrl = "", fetch, queryClient: given }: AppProps) {
  const [queryClient] = useState(() => given ?? new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));

  return (
    <AuthProvider client={auth}>
      <ApiProvider baseUrl={apiUrl} auth={auth} fetch={fetch}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </ApiProvider>
    </AuthProvider>
  );
}
