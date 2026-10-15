import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../api/ApiProvider";
import { useAuth } from "../auth/AuthProvider";

export type Me = Schemas["Me"];
export type MyMembership = Schemas["MyMembership"];

export const meKey = ["me"] as const;

/**
 * The signed-in caller's account and studios. The first load calls `POST /api/v1/session`, which creates the account
 * on first use and refreshes its email from Cognito, and returns the same body as `GET /me` (docs/26 section 2.3).
 * It is idempotent, so a reload that calls it again is harmless; the data stays fresh until a change replaces it.
 */
export function useMe() {
  const api = useApi();
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: meKey,
    queryFn: () => unwrap(api.POST("/api/v1/session")),
    enabled: isSignedIn,
    staleTime: Infinity,
    // A 4xx (disabled account, rejected token) will not change on a retry; a network error or a 5xx might.
    retry: (failures, error) => failures < 1 && !(error instanceof TempoApiError && error.status < 500),
  });
}

/** The account, for screens under <RequireAccount>, which renders them only once it is loaded. */
export function useAccount(): Me {
  const { data } = useMe();
  if (!data) throw new Error("useAccount needs <RequireAccount> above it");
  return data;
}

export function useUpdateMe() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UpdateMeRequest"]) => unwrap(api.PATCH("/api/v1/me", { body })),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  });
}

/** The studios the caller can use now: active memberships in active studios. */
export function activeMemberships(me: Me): MyMembership[] {
  return me.memberships.filter(
    (membership) => membership.status === "active" && membership.organization.status === "active",
  );
}

/** The name to show: the display name, else the part of the email before `@`. */
export function nameOf(me: Me): string {
  return me.displayName?.trim() || me.email.split("@")[0] || me.email;
}

const roleNames: Record<Schemas["Role"], string> = { owner: "בעלים", admin: "מנהל", staff: "צוות", client: "מתאמן" };

/** The system roles' Hebrew names, as migration 0005 stores them. */
export function roleName(role: Schemas["Role"]): string {
  return roleNames[role];
}

/** The caller's role in a studio. Until the Phase 2 API is deployed (K5) dev sends only the deprecated `role`. */
export function membershipRoleName(membership: MyMembership): string {
  return (membership.roles ?? [])[0]?.displayName ?? roleName(membership.role);
}

/** docs/29 section 8, seeded into the system roles by migration 0010. */
const scheduling = {
  staff: ["schedule.view", "bookings.manage", "attendance.mark", "passes.view"],
  manage: ["schedule.view", "schedule.manage", "bookings.manage", "attendance.mark", "passes.view", "passes.manage"],
} as const;

/** The Phase 1 matrix as permissions (docs/27 section 3.1), for a membership the API sent without them. */
const rolePermissions: Record<Schemas["Role"], readonly string[]> = {
  owner: [
    "organization.view",
    "organization.settings.manage",
    "members.view",
    "members.invite.staff",
    "members.invite.admin",
    "members.manage",
    "roles.manage",
    "audit.view",
    "people.view",
    "people.manage",
    "people.merge",
    "people.export",
    "people.erase",
    "consent.manage",
    "ownership.transfer",
    ...scheduling.manage,
  ],
  admin: [
    "organization.view",
    "organization.settings.manage",
    "members.view",
    "members.invite.staff",
    "members.manage",
    "audit.view",
    "people.view",
    "people.manage",
    "people.merge",
    "people.export",
    "consent.manage",
    ...scheduling.manage,
  ],
  staff: ["organization.view", "members.view", "people.view", "people.manage", ...scheduling.staff],
  client: ["organization.view", "schedule.view"],
};

/**
 * What the caller may do in a studio: `permissions` from GET /me. Until the Phase 2 API is deployed (K5) dev sends
 * none, so the role's Phase 1 set stands in. The apps only show or hide actions with it; the API decides.
 */
export function permissionsOf(membership: MyMembership): ReadonlySet<string> {
  const sent = membership.permissions ?? [];
  return new Set(sent.length > 0 ? sent : rolePermissions[membership.role]);
}

/** The studios this console serves: live memberships whose roles can see the member list (owner, admin, staff). */
export function consoleStudios(me: Me): MyMembership[] {
  return activeMemberships(me).filter((membership) => permissionsOf(membership).has("members.view"));
}
