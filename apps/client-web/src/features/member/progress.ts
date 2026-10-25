// The member's progress in one studio on the real API (docs/31 section 12, G-1 to G-3): visits this month, the
// monthly goal the member sets, and the streak of weeks. Only attended classes count, so it changes when the
// studio marks attendance, not when the member books.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";

export type MyProgress = Schemas["MyProgress"];

export const progressKey = (organizationId: string) => ["studio", organizationId, "progress"] as const;

/** The lowest and highest monthly goal (G-1). */
export const goalRange = { min: 1, max: 31 } as const;

const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof TempoApiError && error.status < 500);

/** The member's progress in the studio; nothing is asked while there is no studio. */
export function useMyProgress(organizationId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: progressKey(organizationId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/progress", {
          params: { path: { organizationId: organizationId! } },
        }),
      ),
    enabled: Boolean(organizationId) && enabled,
    // Fresh for as long as the home's one read (O5), so the home doesn't ask again for what it just got.
    staleTime: 30_000,
    retry: retryOnce,
  });
}

/** Sets the monthly goal, or clears it with null; the answer is the new progress. */
export function useSetMonthlyGoal(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (monthlyGoal: number | null) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/me/progress/goal", {
          params: { path: { organizationId } },
          body: { monthlyGoal },
        }),
      ),
    onSuccess: (progress) => queryClient.setQueryData(progressKey(organizationId), progress),
  });
}

/** "לא הוגדר", "שיעור אחד בחודש", "12 שיעורים בחודש". */
export function goalText(goal: number | null): string {
  if (goal === null) return "לא הוגדר";
  return goal === 1 ? "שיעור אחד בחודש" : `${goal} שיעורים בחודש`;
}

/** "שבוע אחד ברצף", "6 שבועות ברצף"; nothing to boast about yet at zero. */
export function streakText(weeks: number): string {
  if (weeks <= 0) return "עוד אין רצף שבועי";
  return weeks === 1 ? "שבוע אחד ברצף" : `${weeks} שבועות ברצף`;
}
