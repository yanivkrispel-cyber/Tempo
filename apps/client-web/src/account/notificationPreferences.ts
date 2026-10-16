import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../api/ApiProvider";

export type NotificationPreferences = Schemas["NotificationPreferences"];
export type NotificationPreferencesInput = Schemas["NotificationPreferencesInput"];
export type NotificationGroup = Schemas["NotificationGroupPreference"]["group"];
export type ReminderSwitches = Schemas["ReminderSwitches"];
export type QuietHours = Schemas["QuietHours"];

const preferencesKey = (organizationId: string) => ["studio", organizationId, "notification-preferences"] as const;

/** The member's channels per group, reminder switches and quiet hours in one studio (docs/30 section 7). */
export function useNotificationPreferences(organizationId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: preferencesKey(organizationId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/notification-preferences", {
          params: { path: { organizationId: organizationId! } },
        }),
      ),
    enabled: Boolean(organizationId),
  });
}

/** PUT with the version the preferences were read at; a stale one answers 409 `concurrency.conflict`. */
export function useSaveNotificationPreferences(organizationId: string, version: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [organizationId, "notifications.preferences.update"],
    mutationFn: (body: NotificationPreferencesInput) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/me/notification-preferences", {
          params: { path: { organizationId }, header: version ? { "If-Match": version } : {} },
          body,
        }),
      ),
    onSuccess: (saved) => queryClient.setQueryData(preferencesKey(organizationId), saved),
  });
}
