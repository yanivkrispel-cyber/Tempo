import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { useStudio } from "../../features/console/studio";

export interface StudioTimeZone {
  /** The studio's IANA zone, e.g. "Asia/Jerusalem"; null until the studio record has loaded. */
  timeZone: string | null;
  error: unknown;
}

/**
 * The studio's time zone, from its record: classes are shown and created on the studio's clock, never the device's,
 * and nothing guesses a zone before the record arrives.
 */
export function useStudioTimeZone(): StudioTimeZone {
  const api = useApi();
  const { organizationId } = useStudio();
  // Same key as the settings page, so they share one request.
  const organization = useQuery({
    queryKey: ["studio", organizationId, "organization"],
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
  });
  return { timeZone: organization.data?.timeZone ?? null, error: organization.error };
}
