import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { useStudio } from "../console/studio";
import type { Period } from "./period";

export type ReportSummary = Schemas["ReportSummary"];
export type ReportFigures = Schemas["ReportFigures"];
export type PassesEndingReport = Schemas["PassesEndingReport"];
export type MembersAtRiskReport = Schemas["MembersAtRiskReport"];

const reportsKey = (organizationId: string) => ["studio", organizationId, "reports"] as const;

/**
 * GET …/reports/summary (docs/32 section 5). With no period the server picks the last 4 full weeks in the studio's
 * time zone, so the default view needs no clock of its own.
 */
export function useReportSummary(period: Period | null, enabled = true) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: [...reportsKey(organizationId), "summary", period?.from ?? null, period?.to ?? null],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/reports/summary", {
          params: { path: { organizationId }, query: period ? { from: period.from, to: period.to } : {} },
        }),
      ),
    enabled,
  });
}

/** The two lists need `people.view` too (R-6); the page doesn't ask without it. */
export function usePassesEnding(enabled: boolean) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: [...reportsKey(organizationId), "passes-ending"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/reports/passes-ending", {
          params: { path: { organizationId } },
        }),
      ),
    enabled,
  });
}

export function useMembersAtRisk(enabled: boolean) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: [...reportsKey(organizationId), "members-at-risk"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/reports/members-at-risk", {
          params: { path: { organizationId } },
        }),
      ),
    enabled,
  });
}
