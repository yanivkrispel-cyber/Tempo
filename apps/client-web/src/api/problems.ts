import { useQueryClient } from "@tanstack/react-query";
import { TempoApiError } from "@tempo/api-client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a request in the query or mutation cache failed with one of `codes`. Screens show their own error; this
 * lets the frame explain a state that blocks every request at once (`auth.mfa_required`, `billing.restricted`) in
 * one place. It clears when the failed request succeeds or leaves the cache.
 *
 * `scope` (a studio id) keeps only requests whose query or mutation key holds it, so one studio's state does not
 * show in another's console.
 */
export function useProblemCode(codes: readonly string[], scope?: string): boolean {
  const queryClient = useQueryClient();
  const wanted = codes.join(" ");
  const subscribe = useCallback(
    (listener: () => void) => {
      const queries = queryClient.getQueryCache().subscribe(listener);
      const mutations = queryClient.getMutationCache().subscribe(listener);
      return () => {
        queries();
        mutations();
      };
    },
    [queryClient],
  );
  const snapshot = useCallback(() => {
    const inScope = (key: readonly unknown[] | undefined) => scope === undefined || (key ?? []).includes(scope);
    const errors = [
      ...queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => inScope(query.queryKey))
        .map((query) => query.state.error),
      ...queryClient
        .getMutationCache()
        .getAll()
        .filter((mutation) => inScope(mutation.options.mutationKey))
        .map((mutation) => mutation.state.error),
    ];
    const codeList = wanted.split(" ");
    return errors.some((error) => error instanceof TempoApiError && codeList.includes(error.code));
  }, [queryClient, wanted, scope]);
  return useSyncExternalStore(subscribe, snapshot);
}
