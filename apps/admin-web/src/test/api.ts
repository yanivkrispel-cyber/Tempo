import { vi } from "vitest";
import type { Me } from "../account/account";

export const sampleMe: Me = {
  id: "0199e5a1-0000-7000-8000-000000000001",
  email: "dana@example.com",
  emailVerified: true,
  displayName: "דנה כהן",
  locale: "he-IL",
  status: "active",
  memberships: [
    {
      membershipId: "0199e5a1-0000-7000-8000-000000000002",
      role: "owner",
      roles: [{ id: "00000000-0000-7000-8000-000000000001", key: "owner", displayName: "בעלים", isSystem: true }],
      permissions: [
        "audit.view",
        "consent.manage",
        "members.invite.admin",
        "members.invite.staff",
        "members.manage",
        "members.view",
        "organization.settings.manage",
        "organization.view",
        "ownership.transfer",
        "people.erase",
        "people.export",
        "people.manage",
        "people.merge",
        "people.view",
        "roles.manage",
      ],
      pendingOwnershipTransfer: null,
      status: "active",
      organization: {
        id: "0199e5a1-0000-7000-8000-000000000003",
        slug: "neshima",
        displayName: "סטודיו נשימה",
        status: "active",
      },
    },
  ],
};

type SystemRole = "owner" | "admin" | "staff" | "client";

const systemRoleNames: Record<SystemRole, string> = { owner: "בעלים", admin: "מנהל", staff: "צוות", client: "מתאמן" };

/** A system role as `roles` carries it (migration 0005's fixed ids, features/roles/catalog.ts). */
export function roleSummary(role: SystemRole) {
  const index = ["owner", "admin", "staff", "client"].indexOf(role) + 1;
  return {
    id: `00000000-0000-7000-8000-00000000000${index}`,
    key: role,
    displayName: systemRoleNames[role],
    isSystem: true,
  };
}

/** The system roles' permissions (docs/27 section 3.1, the Phase 1 matrix). */
const systemRolePermissions: Record<SystemRole, readonly string[]> = {
  owner: sampleMe.memberships[0]!.permissions,
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
  ],
  staff: ["organization.view", "members.view", "people.view", "people.manage"],
  client: ["organization.view"],
};

/**
 * sampleMe's studio membership with one system role, as GET /me sends it. The deprecated `role` field says `client`
 * on purpose, whatever the role: the apps read `roles` and `permissions`, and a test that leans on `role` fails.
 */
export function membershipAs(role: SystemRole, overrides: Record<string, unknown> = {}) {
  return {
    ...sampleMe.memberships[0]!,
    role: "client" as const,
    roles: [roleSummary(role)],
    permissions: [...systemRolePermissions[role]],
    ...overrides,
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Problem Details, as the API sends errors. */
export function problem(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: code, status, code }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

type Handler = (request: Request) => Response | Promise<Response>;

/**
 * A fetch for the Tempo API: routes are "METHOD /path"; a value is a JSON body (200), a Response or a handler.
 * Unknown routes answer 404. Every request is kept in `requests`, its body read once in `bodies`.
 */
export function apiStub(routes: Record<string, unknown>) {
  const requests: Request[] = [];
  const bodies: unknown[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const request = input as Request;
    // The body goes at its request's index: reading it is async, and requests can overlap.
    const index = requests.push(request) - 1;
    const text = await request.clone().text();
    bodies[index] = text ? JSON.parse(text) : undefined;
    const route = routes[`${request.method} ${new URL(request.url).pathname}`];
    if (route === undefined) return problem(404, "http.404");
    if (typeof route === "function") return (route as Handler)(request);
    if (route instanceof Response) return route.clone();
    return json(route);
  });
  return { fetch, requests, bodies };
}

export const signedInRoutes = { "POST /api/v1/session": sampleMe };
