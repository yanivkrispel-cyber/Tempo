// The premium capabilities on the real API (docs/33): the room map and spots, the usual spot, buddies, the check-in
// code, instructors, and the member's own picture. Keys start with the studio's id like everything in studio.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { studioKeys, type Booking } from "./studio";

export type SessionSpots = Schemas["SessionSpots"];
export type SessionSpot = Schemas["SessionSpot"];
export type CheckinCode = Schemas["CheckinCode"];
export type Buddy = Schemas["Buddy"];
export type Instructor = Schemas["Instructor"];

export const experienceKeys = {
  spots: (organizationId: string, sessionId: string) =>
    ["studio", organizationId, "schedule", "spots", sessionId] as const,
  checkin: (organizationId: string) => ["studio", organizationId, "checkin-code"] as const,
  buddies: (organizationId: string) => ["studio", organizationId, "buddies"] as const,
  instructors: (organizationId: string) => ["studio", organizationId, "instructors"] as const,
  profile: (organizationId: string) => ["studio", organizationId, "my-profile"] as const,
};

const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof TempoApiError && error.status < 500);

/** The room map of one class, as the caller may see it; off when the room has no spot selection. */
export function useSessionSpots(organizationId: string, sessionId: string | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: experienceKeys.spots(organizationId, sessionId ?? "none"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions/{sessionId}/spots", {
          params: { path: { organizationId, sessionId: sessionId! } },
        }),
      ),
    enabled: enabled && sessionId !== null,
    staleTime: 15_000,
    retry: retryOnce,
  });
}

/** Books the caller, on a chosen spot when the room has spots (the server picks the usual or first free one otherwise). */
export function useBookSpot(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, spotId }: { sessionId: string; spotId?: string }) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/sessions/{sessionId}/bookings", {
          params: { path: { organizationId, sessionId } },
          body: spotId ? { spotId } : {},
        }),
      ) as Promise<Booking>,
    onSettled: () => queryClient.invalidateQueries({ queryKey: studioKeys.schedule(organizationId) }),
  });
}

/** Saves a spot as the caller's usual one in a room (null clears it). */
export function useUsualSpot(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, spotId }: { roomId: string; spotId: string | null }) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/me/spot-preferences/{roomId}", {
          params: { path: { organizationId, roomId } },
          body: { spotId },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.schedule(organizationId) }),
  });
}

/** The rotating check-in code; refetched when it rotates while the QR is on screen. */
export function useCheckinCode(organizationId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: experienceKeys.checkin(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/checkin-code", { params: { path: { organizationId } } }),
      ),
    enabled,
    staleTime: 0,
    refetchInterval: (query) => Math.max(1, query.state.data?.validForSeconds ?? 30) * 1000,
    retry: retryOnce,
  });
}

export function useBuddies(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: experienceKeys.buddies(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/buddies", { params: { path: { organizationId } } }),
      ).then((list) => list.items),
    retry: retryOnce,
  });
}

/** The member's own link for a class card (SL-8); `showName` decides whether the invite names her. */
export function useShareLink(organizationId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (body: { sessionId: string; showName: boolean }) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/share-link", {
          params: { path: { organizationId } },
          body: { channel: "member_card", ...body },
        }),
      ),
  });
}

/** Her own referral link to the studio (docs/37 section 8.5, "הביאי חברה"); one per member, reused by the API. */
export function useReferralLink(organizationId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (showName: boolean) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/share-link", {
          params: { path: { organizationId } },
          body: { channel: "referral", showName },
        }),
      ),
  });
}

/** What her referral link earns her (M-17), as its public answer says: the product's name, or null. */
export function useReferralReward(slug: string, code: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["public-studio", slug, "link", code],
    queryFn: () =>
      unwrap(api.GET("/api/v1/public/studios/{slug}/links/{code}", { params: { path: { slug, code: code! } } })),
    enabled: Boolean(code),
    staleTime: 5 * 60_000,
    retry: false,
    select: (link) => link.reward?.productName.trim() || null,
  });
}

export function useBuddyCode(organizationId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/buddy-code", { params: { path: { organizationId } } }),
      ),
  });
}

export function useLinkBuddy(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/buddies", {
          params: { path: { organizationId } },
          body: { code },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId] }),
  });
}

export function useUnlinkBuddy(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/me/buddies/{personId}", {
          params: { path: { organizationId, personId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId] }),
  });
}

/** The studio's instructors with their photo and links, by membership id. */
export function useInstructors(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: experienceKeys.instructors(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/instructors", { params: { path: { organizationId } } }),
      ).then((list) => new Map(list.items.map((instructor) => [instructor.membershipId, instructor]))),
    staleTime: 5 * 60_000,
    retry: retryOnce,
  });
}

/** The caller's own person record in the studio (name, avatar). */
export function useMyProfile(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: experienceKeys.profile(organizationId),
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/me/profile", { params: { path: { organizationId } } })),
    staleTime: 60_000,
    retry: retryOnce,
  });
}

/**
 * A picture: an upload ticket, a presigned POST straight to storage, then finalize (docs/33 section 6.3). The server re-encodes
 * the file; nothing is shown until it says the picture is ready.
 */
export function useUploadPicture(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      purpose,
      ownerId,
      file,
    }: {
      purpose: Schemas["MediaPurpose"];
      ownerId: string;
      file: File;
    }) => {
      const contentType = file.type as "image/jpeg" | "image/png" | "image/webp";
      const ticket = await unwrap(
        api.POST("/api/v1/organizations/{organizationId}/media/uploads", {
          params: { path: { organizationId } },
          body: { purpose, ownerId, contentType, bytes: file.size },
        }),
      );
      await sendToStorage(ticket.uploadForm, file);
      return unwrap(
        api.POST("/api/v1/organizations/{organizationId}/media/uploads/{mediaId}/finalize", {
          params: { path: { organizationId, mediaId: ticket.mediaId } },
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId] }),
  });
}

/**
 * Sends the file to storage as the ticket's presigned POST (H-1): every field as given, the file last, as S3 asks.
 * S3 itself refuses a file over the ticket's size. Its XML refusal becomes a Problem (`media.too_large`, or
 * `media.storage_refused`), so the screen reads it like any other API error.
 */
async function sendToStorage(form: Schemas["MediaUploadForm"], file: File): Promise<void> {
  const body = new FormData();
  for (const [name, value] of Object.entries(form.fields)) body.append(name, value);
  body.append("file", file);
  const sent = await fetch(form.url, { method: "POST", body });
  if (sent.ok) return;
  const xml = await sent.text().catch(() => "");
  const code = xml.includes("<Code>EntityTooLarge</Code>") ? "media.too_large" : "media.storage_refused";
  throw new TempoApiError(sent, { type: "about:blank", title: code, status: sent.status, code });
}
