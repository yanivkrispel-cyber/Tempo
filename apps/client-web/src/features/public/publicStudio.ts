// A studio's public page and classes, for a visitor who is not a member yet (docs/37 section 4). Every read is public
// and carries no person data (S-B); joining needs a signed-in caller with a verified email (S-D).
import { useMutation, useQuery } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas, type TempoClient } from "@tempo/api-client";
import { activeMemberships, type Me } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import type { IsoDate } from "../../shared/utilities/dates";
import { currentSource } from "./source";

export type PublicStudio = Schemas["PublicStudio"];
export type PublicSession = Schemas["PublicSession"];

/** The API answers a range of up to 14 days, from yesterday on (PublicStudioReads.MaxDays). */
export const publicRangeDays = 14;

/** A 4xx will not change on a retry; a network error or a 5xx might. */
const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof TempoApiError && error.status < 500);

export const isNotFound = (error: unknown) => error instanceof TempoApiError && error.status === 404;

/** Whether the signed-in account is an active member of the studio. */
export const isMemberOf = (me: Me, slug: string) =>
  activeMemberships(me).some((membership) => membership.organization.slug === slug);

const publicKeys = {
  studio: (slug: string) => ["public-studio", slug] as const,
  sessions: (slug: string, from: IsoDate, to: IsoDate) => ["public-studio", slug, "sessions", from, to] as const,
  session: (slug: string, sessionId: string) => ["public-studio", slug, "session", sessionId] as const,
};

export function usePublicStudio(slug: string) {
  const api = useApi();
  return useQuery({
    queryKey: publicKeys.studio(slug),
    queryFn: () => unwrap(api.GET("/api/v1/public/studios/{slug}", { params: { path: { slug } } })),
    staleTime: 5 * 60_000,
    retry: retryOnce,
  });
}

/** The studio's public classes from `from` to `to` (studio dates, inclusive). */
export function usePublicSessions(slug: string, from: IsoDate, to: IsoDate, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: publicKeys.sessions(slug, from, to),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/public/studios/{slug}/sessions", { params: { path: { slug }, query: { from, to } } }),
      ).then((list) => list.items),
    enabled,
    staleTime: 60_000,
    retry: retryOnce,
  });
}

export function usePublicSession(slug: string, sessionId: string) {
  const api = useApi();
  return useQuery({
    queryKey: publicKeys.session(slug, sessionId),
    queryFn: () =>
      unwrap(api.GET("/api/v1/public/studios/{slug}/sessions/{sessionId}", { params: { path: { slug, sessionId } } })),
    staleTime: 30_000,
    retry: retryOnce,
  });
}

/** Joins the studio as a member, with the first-touch source; joining twice is harmless (`created: false`). */
export function useJoinStudio(slug: string) {
  const api = useApi();
  return useMutation({ mutationFn: () => joinStudio(api, slug) });
}

/** The join itself; `headers` carries a token the app has not adopted yet (the sheet's own sign-up). */
export function joinStudio(api: TempoClient, slug: string, headers?: Record<string, string>) {
  return unwrap(
    api.POST("/api/v1/public/studios/{slug}/join", {
      params: { path: { slug } },
      body: { src: currentSource() },
      headers,
    }),
  );
}
