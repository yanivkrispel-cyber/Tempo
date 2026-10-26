import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { useStudio } from "../../features/console/studio";

export interface StudioTimeZone {
  /** The studio's IANA zone, e.g. "Asia/Jerusalem"; null until the session or the studio record says it. */
  timeZone: string | null;
  error: unknown;
}

/**
 * The studio's time zone: classes are shown and created on the studio's clock, never the device's, and nothing
 * guesses a zone. The session's membership carries it (board #523, K3), so the console's pages don't wait a round for
 * the studio record; an older API leaves it out, and then the record is read.
 */
export function useStudioTimeZone(): StudioTimeZone {
  const api = useApi();
  const { organizationId, membership } = useStudio();
  const fromSession = membership.organization.timeZone ?? null;
  // Same key as the settings page, so they share one request, and a zone saved there wins over the session's.
  const organization = useQuery({
    queryKey: ["studio", organizationId, "organization"],
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
    enabled: fromSession === null,
  });
  return {
    timeZone: organization.data?.timeZone ?? fromSession,
    error: fromSession === null ? organization.error : null,
  };
}
