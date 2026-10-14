import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider, type createBrowserRouter } from "react-router";
import { SampleApiProvider } from "../features/member/data";
import { ToastProvider } from "../shared/design-system";
import type { IsoDate } from "../shared/utilities/dates";

type Router = ReturnType<typeof createBrowserRouter>;

export interface AppProps {
  router: Router;
  /** The sample data's "today"; the device date by default. Tests pass a fixed date. */
  today?: IsoDate;
}

export function App({ router, today }: AppProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));

  return (
    <QueryClientProvider client={queryClient}>
      <SampleApiProvider today={today}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </SampleApiProvider>
    </QueryClientProvider>
  );
}
