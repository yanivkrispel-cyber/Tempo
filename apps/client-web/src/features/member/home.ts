// The member's home in one read (board #511, O5): `GET /me/home` answers what the home's separate reads answered,
// and each part seeds the cache its own hook reads, so the other screens find it there too.
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { experienceKeys } from "./experience";
import { progressKey } from "./progress";
import { studioKeys } from "./studio";

export type MyHome = Schemas["MyHome"];

export const homeKey = (organizationId: string) => ["studio", organizationId, "home"] as const;

function seed(queryClient: QueryClient, organizationId: string, home: MyHome) {
  queryClient.setQueryData(studioKeys.organization(organizationId), home.studio);
  queryClient.setQueryData(studioKeys.myBookings(organizationId, "upcoming"), home.upcomingBookings);
  queryClient.setQueryData(studioKeys.sessions(organizationId, home.week.from, home.week.to), home.week.sessions);
  queryClient.setQueryData(progressKey(organizationId), home.progress);
  queryClient.setQueryData(studioKeys.myPasses(organizationId), home.passes);
  queryClient.setQueryData(experienceKeys.profile(organizationId), home.profile);
  queryClient.setQueryData(studioKeys.inbox(organizationId), home.notifications);
  queryClient.setQueryData(
    experienceKeys.instructors(organizationId),
    new Map(home.instructors.map((instructor) => [instructor.membershipId, instructor])),
  );
}

/**
 * Reads the home and seeds the parts' caches. The home's own hooks wait while this is fetching; when it fails (an API
 * without `/me/home`, or an error) they read separately, so the home never depends on this one call.
 */
export function useMyHome(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: homeKey(organizationId),
    queryFn: async () => {
      const home = await unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/home", { params: { path: { organizationId } } }),
      );
      seed(queryClient, organizationId, home);
      return home;
    },
    staleTime: 30_000,
    retry: false,
  });
}
