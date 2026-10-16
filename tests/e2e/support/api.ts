import { readFileSync } from "node:fs";
import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { adminUrl, sessionStatePath, studioSlug } from "./env";

/**
 * Direct API calls for seeding and cleanup, as the smoke user, with the access token the admin-web sign-in saved
 * (`tempo.admin-web.session` in localStorage, packages/api-client/src/auth/authClient.ts). The UI is what the
 * specs test; this only prepares data and removes it.
 */
export class Api {
  private constructor(
    private readonly context: APIRequestContext,
    readonly organizationId: string,
  ) {}

  static async open(): Promise<Api> {
    const apiUrl = process.env.E2E_API_URL;
    if (!apiUrl) throw new Error("E2E_API_URL is not resolved (support/env.ts).");
    const token = savedAccessToken();
    const context = await request.newContext({
      baseURL: apiUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const me = await json<{ memberships: { organization: { id: string; slug: string } }[] }>(
      await context.get("/api/v1/me"),
    );
    const studio = me.memberships.find((membership) => membership.organization.slug === studioSlug);
    if (!studio) throw new Error(`The smoke user is not a member of ${studioSlug}.`);
    return new Api(context, studio.organization.id);
  }

  async createPerson(body: {
    displayName: string;
    email?: string;
    phone?: string;
  }): Promise<{ id: string; displayName: string }> {
    return json(await this.context.post(`${this.studioPath}/people`, { data: body }));
  }

  /** Anonymizes the record (the only way to remove one; needs a sign-in in the last ten minutes), else archives it. */
  async removePerson(personId: string): Promise<void> {
    const erased = await this.context.post(`${this.studioPath}/people/${personId}/erase`, {
      data: { reason: "e2e test cleanup" },
    });
    if (erased.ok()) return;
    const person = await json<{ version: string; status: string }>(
      await this.context.get(`${this.studioPath}/people/${personId}`),
    );
    if (person.status !== "active") return;
    await json(
      await this.context.patch(`${this.studioPath}/people/${personId}`, {
        data: { status: "archived" },
        headers: { "If-Match": person.version },
      }),
    );
  }

  /** Revokes every pending invitation to an `e2e-` address. */
  async revokeE2eInvitations(): Promise<void> {
    const page = await json<{ items: { id: string; email: string; status: string }[] }>(
      await this.context.get(`${this.studioPath}/invitations`, { params: { status: "pending", limit: 100 } }),
    );
    for (const invitation of page.items.filter((item) => item.email.startsWith("e2e-"))) {
      const response = await this.context.delete(`${this.studioPath}/invitations/${invitation.id}`);
      if (!response.ok() && response.status() !== 404)
        throw new Error(`Revoking an e2e invitation answered ${response.status()}.`);
    }
  }

  /** Every active or archived person whose name starts with `e2e-`, e.g. left behind by an interrupted run. */
  async e2ePeople(): Promise<{ id: string; displayName: string }[]> {
    const found: { id: string; displayName: string }[] = [];
    for (const status of ["active", "archived"]) {
      const page = await json<{ items: { id: string; displayName: string }[] }>(
        await this.context.get(`${this.studioPath}/people`, { params: { query: "e2e-", status, limit: 100 } }),
      );
      found.push(...page.items.filter((person) => person.displayName.startsWith("e2e-")));
    }
    return found;
  }

  /**
   * A studio call for the seeding the dedicated helpers do not cover: `path` is relative to the studio
   * (`/sessions`). Answers the parsed body (undefined on 204) and fails on any status not in `accept`.
   */
  async call<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: {
      data?: unknown;
      params?: Record<string, string | number>;
      headers?: Record<string, string>;
      accept?: number[];
    } = {},
  ): Promise<T> {
    const response = await this.context.fetch(`${this.studioPath}${path}`, {
      method,
      data: options.data,
      params: options.params,
      headers: options.headers,
    });
    if (options.accept?.includes(response.status())) {
      return (response.status() === 204 ? undefined : await response.json().catch(() => undefined)) as T;
    }
    return json<T>(response);
  }

  /** The Person record of the signed-in smoke user (the member in client-web), found by its membership. */
  async ownPerson(): Promise<{ id: string; displayName: string } | undefined> {
    const me = await json<{ memberships: { membershipId: string; organization: { id: string } }[] }>(
      await this.context.get("/api/v1/me"),
    );
    const membershipId = me.memberships.find((item) => item.organization.id === this.organizationId)?.membershipId;
    let before: string | undefined;
    do {
      const page = await this.call<{
        items: { id: string; displayName: string; membershipId?: string | null }[];
        nextBefore?: string | null;
      }>("GET", "/people", { params: { limit: 100, ...(before ? { before } : {}) } });
      const own = page.items.find((person) => person.membershipId === membershipId);
      if (own) return own;
      before = page.nextBefore ?? undefined;
    } while (before);
    return undefined;
  }

  dispose(): Promise<void> {
    return this.context.dispose();
  }

  private get studioPath(): string {
    return `/api/v1/organizations/${this.organizationId}`;
  }
}

function savedAccessToken(): string {
  const state = JSON.parse(readFileSync(sessionStatePath, "utf8")) as {
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
  };
  const raw = state.origins
    .find((origin) => origin.origin === adminUrl)
    ?.localStorage.find((item) => item.name === "tempo.admin-web.session")?.value;
  if (!raw) throw new Error("No admin-web session in the saved storage state.");
  return (JSON.parse(raw) as { accessToken: string }).accessToken;
}

async function json<T = unknown>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${new URL(response.url()).pathname} answered ${response.status()}.`);
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/** A name that marks the record as test data and is unique per run. */
export function e2eName(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}`;
}
