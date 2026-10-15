import { vi } from "vitest";
import type { Me } from "../account/account";

export const sampleMe: Me = {
  id: "0199e5a1-0000-7000-8000-000000000001",
  email: "noga@example.com",
  emailVerified: true,
  displayName: "נגה רוזן",
  locale: "he-IL",
  status: "active",
  memberships: [
    {
      membershipId: "0199e5a1-0000-7000-8000-000000000002",
      role: "client",
      roles: [],
      permissions: [],
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
    requests.push(request);
    const text = await request.clone().text();
    bodies.push(text ? JSON.parse(text) : undefined);
    const route = routes[`${request.method} ${new URL(request.url).pathname}`];
    if (route === undefined) return problem(404, "http.404");
    if (typeof route === "function") return (route as Handler)(request);
    if (route instanceof Response) return route.clone();
    return json(route);
  });
  return { fetch, requests, bodies };
}

const consent = (purpose: string, channel: string, state: string) => ({
  id: `0199e5a1-0000-7000-8000-0000000009${purpose.length}${channel.length}`,
  purpose,
  channel,
  state,
  method: "self",
  textVersion: "draft-2026-10-15",
  occurredAt: "2026-10-14T08:00:00Z",
});

/** The member's own record in the sample studio: reminders by push and email on, marketing never chosen. */
export const sampleProfile = {
  id: "0199e5a1-0000-7000-8000-000000000801",
  displayName: "נגה רוזן",
  givenName: "נגה",
  familyName: "רוזן",
  birthDate: null,
  status: "active",
  source: "join_link",
  hasLogin: true,
  membershipId: sampleMe.memberships[0]!.membershipId,
  primaryEmail: "noga@example.com",
  primaryPhone: null,
  mergedIntoId: null,
  createdAt: "2026-10-14T08:00:00Z",
  version: "2",
  contactPoints: [],
  consents: [consent("reminders", "push", "granted"), consent("reminders", "email", "granted")],
  relationships: [],
};

export const signedInRoutes = {
  "POST /api/v1/session": sampleMe,
  [`GET /api/v1/organizations/${sampleMe.memberships[0]!.organization.id}/me/profile`]: sampleProfile,
};
