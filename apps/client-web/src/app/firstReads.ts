import type { QueryClient } from "@tanstack/react-query";
import type { TempoClient } from "@tempo/api-client";
import { activeMemberships, meQuery, type Me } from "../account/account";
import { myHomeQuery } from "../features/member/home";
import {
  bookingPolicyQuery,
  inboxQuery,
  myPassesQuery,
  pickStudio,
  sessionsQuery,
  upcomingBookingsQuery,
} from "../features/member/studio";
import { readChosenStudio } from "../features/member/studioChoice";
import { defaultTimeZone, studioToday } from "../features/member/studioTime";
import { addDays } from "../shared/utilities/dates";

export interface FirstReads {
  queryClient: QueryClient;
  api: TempoClient;
  /** The page's path inside the app, without a studio's own basename. */
  pathname: string;
  search: string;
  /** The studio of a studio's own app (`/s/<slug>/`); null for the generic app. */
  studioSlug: string | null;
  now?: Date;
}

/**
 * Starts `POST /session` before the first render, and the first screen's reads as soon as it answers, into the same
 * cache entries the screen then reads (board #537, O1). Without this, the session waits for React's first render and
 * the screen's reads for the account, the layout and the screen to render. A screen this doesn't know, a link to
 * another week, or a member with no studio reads nothing ahead; the screen reads as usual.
 */
export function startFirstReads({ queryClient, api, pathname, search, studioSlug, now }: FirstReads): void {
  queryClient
    .fetchQuery(meQuery(api))
    .then((me) => readScreen({ queryClient, api, pathname, search, studioSlug, now }, me))
    // A failed session is the account's to show when it renders; nothing reads ahead.
    .catch(() => undefined);
}

function readScreen({ queryClient, api, pathname, search, studioSlug, now }: FirstReads, me: Me): void {
  const memberships = activeMemberships(me);
  const studio = pickStudio(memberships, studioSlug, studioSlug ? null : readChosenStudio());
  if (!studio) return;
  const id = studio.id;
  const timeZone =
    memberships.find((membership) => membership.organization.id === id)?.organization.timeZone ?? defaultTimeZone;
  const today = studioToday(timeZone, now);

  switch (pathname.replace(/\/+$/, "") || "/") {
    case "/":
      void queryClient.prefetchQuery(myHomeQuery(api, queryClient, id));
      break;
    case "/book":
      // `?day=` may open another week: the screen reads that one itself.
      if (!new URLSearchParams(search).has("day"))
        void queryClient.prefetchQuery(sessionsQuery(api, id, today, addDays(today, 6)));
      void queryClient.prefetchQuery(bookingPolicyQuery(api, id));
      void queryClient.prefetchQuery(myPassesQuery(api, id));
      break;
    case "/bookings":
      void queryClient.prefetchQuery(upcomingBookingsQuery(api, id));
      void queryClient.prefetchQuery(inboxQuery(api, id));
      break;
  }
}
