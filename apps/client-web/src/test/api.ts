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
      organization: { id: "0199e5a1-0000-7000-8000-000000000003", slug: "neshima", displayName: "סטודיו נשימה", status: "active" }
    }
  ]
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Problem Details, as the API sends errors. */
export function problem(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: code, status, code }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers }
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

export const signedInRoutes = { "POST /api/v1/session": sampleMe };
