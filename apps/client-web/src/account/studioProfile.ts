import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../api/ApiProvider";

export type PersonDetail = Schemas["PersonDetail"];
export type ConsentPurpose = Schemas["ConsentPurpose"];
export type ConsentChannel = Schemas["ConsentChannel"];

/**
 * The version of the consent wording the member sees. The real texts are Kris's to write and a lawyer's to check
 * before the pilot (docs/27 P-4); until then the app shows draft wording and records this version with each choice.
 */
export const consentTextVersion = "draft-2026-10-15";

const profileKey = (organizationId: string) => ["studio", organizationId, "my-profile"] as const;

/** The member's own record in one studio: names, birth date, and the current consent per purpose and channel. */
export function useStudioProfile(organizationId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: profileKey(organizationId ?? ""),
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}/me/profile", { params: { path: { organizationId: organizationId! } } })),
    enabled: Boolean(organizationId)
  });
}

/** The latest choice for a purpose and channel; none recorded means not granted (marketing must be opted in). */
export function consentGranted(profile: PersonDetail | undefined, purpose: ConsentPurpose, channel: ConsentChannel): boolean {
  return profile?.consents.find((consent) => consent.purpose === purpose && consent.channel === channel)?.state === "granted";
}

/** Records one consent choice (append-only: a withdrawal is a new row) and updates the profile in place. */
export function useRecordConsent(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (choice: { purpose: ConsentPurpose; channel: ConsentChannel; granted: boolean }) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/consents", {
          params: { path: { organizationId } },
          body: { purpose: choice.purpose, channel: choice.channel, state: choice.granted ? "granted" : "withdrawn", textVersion: consentTextVersion }
        })
      ),
    onSuccess: (recorded) =>
      queryClient.setQueryData<PersonDetail>(profileKey(organizationId), (profile) =>
        profile && {
          ...profile,
          consents: [...profile.consents.filter((c) => !(c.purpose === recorded.purpose && c.channel === recorded.channel)), recorded]
        }
      )
  });
}

/** PATCH /me/profile with the version the record was read at. */
export function useUpdateStudioProfile(organizationId: string, version: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UpdateMyProfileRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/me/profile", {
          params: { path: { organizationId }, header: version ? { "If-Match": version } : {} },
          body
        })
      ),
    onSuccess: (profile) => queryClient.setQueryData(profileKey(organizationId), profile)
  });
}
