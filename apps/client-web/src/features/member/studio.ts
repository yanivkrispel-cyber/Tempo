// The member's studio on the real API: the timetable, bookings, waitlist, passes and the inbox (docs/29 sections 6
// and 9). Every key starts with the studio's id, so two studios never share a cache entry.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas } from "@tempo/api-client";
import { activeMemberships, useAccount } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import type { IsoDate } from "../../shared/utilities/dates";
import { useNow } from "./clock";
import { defaultTimeZone, studioToday } from "./studioTime";

export type Session = Schemas["Session"];
export type Booking = Schemas["Booking"];
export type MyBooking = Schemas["MyBooking"];
export type Pass = Schemas["Pass"];
export type PassSummary = Schemas["PassSummary"];
export type BookingPolicy = Schemas["BookingPolicy"];
export type InboxItem = Schemas["InboxItem"];

/** The studio the member app shows: the first active membership. */
export interface Studio {
  id: string;
  name: string;
}

export function useStudio(): Studio | null {
  const studio = activeMemberships(useAccount())[0]?.organization;
  return studio ? { id: studio.id, name: studio.displayName } : null;
}

export const studioKeys = {
  /** Everything a booking or a cancellation can change: sessions, bookings, passes. */
  schedule: (organizationId: string) => ["studio", organizationId, "schedule"] as const,
  sessions: (organizationId: string, from: IsoDate, to: IsoDate) =>
    ["studio", organizationId, "schedule", "sessions", from, to] as const,
  session: (organizationId: string, sessionId: string) =>
    ["studio", organizationId, "schedule", "session", sessionId] as const,
  myBookings: (organizationId: string, scope: "upcoming" | "past") =>
    ["studio", organizationId, "schedule", "my-bookings", scope] as const,
  myPasses: (organizationId: string) => ["studio", organizationId, "schedule", "my-passes"] as const,
  policy: (organizationId: string) => ["studio", organizationId, "booking-policy"] as const,
  organization: (organizationId: string) => ["studio", organizationId, "organization"] as const,
  inbox: (organizationId: string) => ["studio", organizationId, "inbox"] as const,
};

const org = (organizationId: string) => ({ params: { path: { organizationId } } });

/** A 4xx will not change on a retry; a network error or a 5xx might. */
const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof TempoApiError && error.status < 500);

/** The studio's IANA time zone; the API's default until it loads or when it cannot be read. */
export function useStudioTimeZone(organizationId: string): string {
  const api = useApi();
  const query = useQuery({
    queryKey: studioKeys.organization(organizationId),
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", org(organizationId))),
    staleTime: Infinity,
    retry: retryOnce,
  });
  return query.data?.timeZone ?? defaultTimeZone;
}

/** The studio's time zone, the current moment and today's date in the studio. */
export function useStudioClock(organizationId: string): { timeZone: string; now: Date; today: IsoDate } {
  const timeZone = useStudioTimeZone(organizationId);
  const now = useNow();
  return { timeZone, now, today: studioToday(timeZone, now) };
}

/** Sessions from `from` to `to` (local dates, inclusive), with the caller's own place and the pass a booking would use. */
export function useSessions(organizationId: string, from: IsoDate, to: IsoDate) {
  const api = useApi();
  return useQuery({
    queryKey: studioKeys.sessions(organizationId, from, to),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions", {
          params: { path: { organizationId }, query: { from, to } },
        }),
      ).then((list) => list.items),
    staleTime: 30_000,
    retry: retryOnce,
  });
}

export function useSession(organizationId: string, sessionId: string) {
  const api = useApi();
  return useQuery({
    queryKey: studioKeys.session(organizationId, sessionId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions/{sessionId}", {
          params: { path: { organizationId, sessionId } },
        }),
      ),
    retry: retryOnce,
  });
}

/** Upcoming bookings and waitlist places, soonest first (the API sorts this page by start time). */
export function useUpcomingBookings(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: studioKeys.myBookings(organizationId, "upcoming"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/bookings", {
          params: { path: { organizationId }, query: { scope: "upcoming", limit: 100 } },
        }),
      ).then((page) => page.items),
    staleTime: 30_000,
    retry: retryOnce,
  });
}

/** Past and cancelled bookings, newest first, a page at a time. */
export function usePastBookings(organizationId: string, enabled = true) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: studioKeys.myBookings(organizationId, "past"),
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/bookings", {
          params: {
            path: { organizationId },
            query: { scope: "past", limit: 20, ...(pageParam ? { before: pageParam } : {}) },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null,
    enabled,
    retry: retryOnce,
  });
}

export function useMyPasses(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: studioKeys.myPasses(organizationId),
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/me/passes", org(organizationId))).then(
        (list) => list.items,
      ),
    staleTime: 30_000,
    retry: retryOnce,
  });
}

/** The free-cancellation window, the waitlist cutoff and the booking horizon. */
export function useBookingPolicy(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: studioKeys.policy(organizationId),
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}/booking-policy", org(organizationId))),
    staleTime: 5 * 60_000,
    retry: retryOnce,
  });
}

/** Errors that mean the timetable the member sees is out of date: read it again before explaining. */
const staleCodes = new Set([
  "session.full",
  "session.cancelled",
  "booking.duplicate",
  "booking.closed",
  "booking.not_open",
  "booking.no_valid_pass",
  "booking.not_cancellable",
  "booking.not_found",
  "session.not_found",
]);

function useScheduleMutation<TVariables>(
  organizationId: string,
  mutationFn: (variables: TVariables) => Promise<Booking>,
) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: studioKeys.schedule(organizationId) });
  return useMutation({
    mutationFn,
    // No optimistic update: the server decides between a place, the waitlist and a refusal, under concurrency.
    onSuccess: refresh,
    onError: (error) => {
      if (error instanceof TempoApiError && (error.status === 409 || staleCodes.has(error.code))) void refresh();
    },
  });
}

/** Books the caller; a full session puts them on the waitlist instead (the response's `status` says which). */
export function useBook(organizationId: string) {
  const api = useApi();
  return useScheduleMutation(organizationId, (sessionId: string) =>
    unwrap(
      api.POST("/api/v1/organizations/{organizationId}/sessions/{sessionId}/bookings", {
        params: { path: { organizationId, sessionId } },
      }),
    ),
  );
}

/** Cancels a booking or leaves the waitlist. */
export function useCancelBooking(organizationId: string) {
  const api = useApi();
  return useScheduleMutation(organizationId, (bookingId: string) =>
    unwrap(
      api.POST("/api/v1/organizations/{organizationId}/bookings/{bookingId}/cancel", {
        params: { path: { organizationId, bookingId } },
      }),
    ),
  );
}

export function useInbox(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: studioKeys.inbox(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/notifications", {
          params: { path: { organizationId }, query: { limit: 30 } },
        }),
      ),
    staleTime: 30_000,
    retry: retryOnce,
  });
}

export function useMarkRead(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/notifications/{itemId}/read", {
          params: { path: { organizationId, itemId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.inbox(organizationId) }),
  });
}
