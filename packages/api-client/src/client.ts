import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema";

export type Problem = components["schemas"]["Problem"];

export interface TempoClientOptions {
  /** API origin, e.g. `https://api.example.com`, or `""` for the same origin. */
  baseUrl: string;
  /** The Cognito access token, or null when signed out. Called before every request. */
  getAccessToken: () => string | null | Promise<string | null>;
  /**
   * Behind CloudFront the token goes in `X-Tempo-Authorization`, because CloudFront's
   * origin access control replaces `Authorization` (contract, "Tokens").
   */
  authHeader?: "Authorization" | "X-Tempo-Authorization";
  fetch?: typeof globalThis.fetch;
}

/** An error response from the API, parsed from Problem Details. */
export class TempoApiError extends Error {
  readonly status: number;
  /** The stable code, e.g. `invitation.not_found`; `http.<status>` when the body was not Problem Details. */
  readonly code: string;
  readonly problem: Problem | null;
  readonly correlationId: string | null;
  /** Seconds to wait, from `Retry-After` on a 429. */
  readonly retryAfterSeconds: number | null;

  constructor(response: Response, body: unknown) {
    const problem = isProblem(body) ? body : null;
    super(problem?.detail ?? problem?.title ?? `HTTP ${response.status}`);
    this.name = "TempoApiError";
    this.status = response.status;
    this.code = problem?.code ?? `http.${response.status}`;
    this.problem = problem;
    this.correlationId = problem?.correlationId ?? response.headers.get("X-Correlation-Id");
    const retryAfter = Number(response.headers.get("Retry-After"));
    this.retryAfterSeconds = response.headers.has("Retry-After") && Number.isFinite(retryAfter) ? retryAfter : null;
  }
}

export function isProblem(body: unknown): body is Problem {
  return typeof body === "object" && body !== null && typeof (body as Problem).code === "string" && typeof (body as Problem).status === "number";
}

export function createTempoClient(options: TempoClientOptions) {
  const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: options.fetch });
  const authHeader = options.authHeader ?? "Authorization";

  const headers: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken();
      if (token) request.headers.set(authHeader, `Bearer ${token}`);
      if (!request.headers.has("X-Correlation-Id")) request.headers.set("X-Correlation-Id", crypto.randomUUID());
      return request;
    }
  };
  client.use(headers);
  return client;
}

export type TempoClient = ReturnType<typeof createTempoClient>;

/**
 * Unwraps an openapi-fetch result: returns `data`, or throws `TempoApiError`.
 * Use it inside TanStack Query functions so failures reach the query's error state.
 */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) throw new TempoApiError(response, error);
  return data as T;
}
