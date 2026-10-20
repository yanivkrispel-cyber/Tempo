// The premium capabilities on the console side (docs/33): insights for the Today page, the room map of a class with
// who holds each spot, check-in at the door, room layouts, instructor profiles, pictures and search. Keys start with
// the studio's id like every console query.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { useStudio } from "./studio";

export type Sales = Schemas["Sales"];
export type Occupancy = Schemas["Occupancy"];
/** The cards the Today page draws; the `story_*` cards get their own screen (board #380 MO4). */
export type Suggestion = Schemas["Suggestion"] & { kind: "passes_ending" | "members_at_risk" | "waitlist_pressure" };
export type Activity = Schemas["Activity"];
export type SessionSpots = Schemas["SessionSpots"];
export type SessionSpot = Schemas["SessionSpot"];
export type RoomLayout = Schemas["RoomLayout"];
export type RoomLayoutRequest = Schemas["RoomLayoutRequest"];
export type Instructor = Schemas["Instructor"];
export type Checkin = Schemas["Checkin"];
export type SearchResults = Schemas["SearchResults"];

export const experienceKeys = {
  insights: (organizationId: string, kind: string) => ["studio", organizationId, "insights", kind] as const,
  spots: (organizationId: string, sessionId: string) =>
    ["studio", organizationId, "schedule", "spots", sessionId] as const,
  layout: (organizationId: string, roomId: string) =>
    ["studio", organizationId, "schedule", "rooms", "layout", roomId] as const,
  instructors: (organizationId: string) => ["studio", organizationId, "instructors"] as const,
  search: (organizationId: string, q: string) => ["studio", organizationId, "search", q] as const,
};

// A 403 or 404 means the caller can't see it: the card stays hidden, so there is nothing to retry.
const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof TempoApiError && error.status < 500);

export function useSales(enabled: boolean) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.insights(organizationId, "sales"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/insights/sales", { params: { path: { organizationId } } }),
      ),
    enabled,
    staleTime: 60_000,
    retry: retryOnce,
  });
}

export function useOccupancy(enabled: boolean) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.insights(organizationId, "occupancy"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/insights/occupancy", { params: { path: { organizationId } } }),
      ),
    enabled,
    staleTime: 60_000,
    retry: retryOnce,
  });
}

export function useSuggestions(enabled: boolean) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.insights(organizationId, "suggestions"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/insights/suggestions", {
          params: { path: { organizationId } },
        }),
      ).then((list) => list.items.filter(isCareSuggestion)),
    enabled,
    staleTime: 60_000,
    retry: retryOnce,
  });
}

function isCareSuggestion(suggestion: Schemas["Suggestion"]): suggestion is Suggestion {
  return !suggestion.kind.startsWith("story_");
}

/** The last 48 hours, refreshed every minute while the page is open. */
export function useActivity(enabled: boolean) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.insights(organizationId, "activity"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/insights/activity", {
          params: { path: { organizationId }, query: { limit: 12 } },
        }),
      ).then((list) => list.items),
    enabled,
    refetchInterval: 60_000,
    retry: retryOnce,
  });
}

/** The room map of one class; staff see who holds each spot and whether they came in. */
export function useSessionSpots(sessionId: string, enabled: boolean, live = false) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.spots(organizationId, sessionId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions/{sessionId}/spots", {
          params: { path: { organizationId, sessionId } },
        }),
      ),
    enabled,
    refetchInterval: live ? 20_000 : false,
    retry: retryOnce,
  });
}

/** Moves a booked place to another spot (staff, `bookings.manage`). */
export function useMoveSpot(sessionId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationFn: ({ bookingId, spotId }: { bookingId: string; spotId: string }) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/bookings/{bookingId}/spot", {
          params: { path: { organizationId, bookingId } },
          body: { spotId },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: experienceKeys.spots(organizationId, sessionId) }),
  });
}

/** A scanned check-in code; the server finds the booking of the class whose check-in is open. */
export function useCheckin() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationFn: (body: Schemas["CheckinRequest"]) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/checkins", { params: { path: { organizationId } }, body }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "schedule"] }),
  });
}

export function useRoomLayout(roomId: string) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.layout(organizationId, roomId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/rooms/{roomId}/layout", {
          params: { path: { organizationId, roomId } },
        }),
      ),
    retry: retryOnce,
  });
}

export function useSaveRoomLayout(roomId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationFn: (body: RoomLayoutRequest) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/rooms/{roomId}/layout", {
          params: { path: { organizationId, roomId } },
          body,
        }),
      ),
    onSuccess: (layout) => {
      queryClient.setQueryData(experienceKeys.layout(organizationId, roomId), layout);
      return queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "schedule"] });
    },
  });
}

/** The studio's instructors with their profile, by membership id. */
export function useInstructorProfiles() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: experienceKeys.instructors(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/instructors", { params: { path: { organizationId } } }),
      ).then((list) => new Map(list.items.map((instructor) => [instructor.membershipId, instructor]))),
    staleTime: 60_000,
    retry: retryOnce,
  });
}

/** Saves an instructor's profile; one's own goes through /me so an instructor without `schedule.manage` can too. */
export function useSaveInstructorProfile(membershipId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const studio = useStudio();
  const { organizationId } = studio;
  const own = membershipId === studio.membership.membershipId;
  return useMutation({
    mutationFn: (body: Schemas["StaffProfileRequest"]) =>
      unwrap(
        own
          ? api.PUT("/api/v1/organizations/{organizationId}/me/staff-profile", {
              params: { path: { organizationId } },
              body,
            })
          : api.PUT("/api/v1/organizations/{organizationId}/instructors/{membershipId}/profile", {
              params: { path: { organizationId, membershipId } },
              body,
            }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: experienceKeys.instructors(organizationId) }),
  });
}

/** The instructor's note to one class, and optionally to its weekly class. */
export function useMemberNote(sessionId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationFn: (body: Schemas["MemberNoteRequest"]) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/sessions/{sessionId}/member-note", {
          params: { path: { organizationId, sessionId } },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "schedule"] }),
  });
}

/**
 * A picture: an upload ticket, a presigned POST straight to storage, then finalize (docs/33 section 6.3). The server re-encodes
 * the file and answers 503 `media.unavailable` while storage is off.
 */
export function useUploadPicture() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
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

/** People and upcoming classes by name, from two letters. */
export function useSearch(q: string) {
  const api = useApi();
  const { organizationId } = useStudio();
  const term = q.trim();
  return useQuery({
    queryKey: experienceKeys.search(organizationId, term),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/search", {
          params: { path: { organizationId }, query: { q: term } },
        }),
      ),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryOnce,
  });
}
