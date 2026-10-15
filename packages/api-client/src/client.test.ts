import { describe, expect, it } from "vitest";
import { createTempoClient, TempoApiError, unwrap } from "./index";

function fakeFetch(response: () => Response) {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return response();
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("createTempoClient", () => {
  it("sends the access token and a correlation id", async () => {
    const { fetch, requests } = fakeFetch(() => json(200, { id: "a" }));
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => "tok", fetch });

    await client.GET("/api/v1/me");

    const [request] = requests;
    expect(request?.url).toBe("https://api.test/api/v1/me");
    expect(request?.headers.get("Authorization")).toBe("Bearer tok");
    expect(request?.headers.get("X-Correlation-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses X-Tempo-Authorization behind CloudFront and leaves Authorization alone", async () => {
    const { fetch, requests } = fakeFetch(() => json(200, {}));
    const client = createTempoClient({
      baseUrl: "",
      getAccessToken: async () => "tok",
      authHeader: "X-Tempo-Authorization",
      fetch,
    });

    await client.GET("/api/v1/me", { baseUrl: "https://app.test" });

    expect(requests[0]?.headers.get("X-Tempo-Authorization")).toBe("Bearer tok");
    expect(requests[0]?.headers.has("Authorization")).toBe(false);
  });

  it("sends no auth header when signed out", async () => {
    const { fetch, requests } = fakeFetch(() => json(200, { status: "healthy" }));
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => null, fetch });

    await client.GET("/api/v1/health");

    expect(requests[0]?.headers.has("Authorization")).toBe(false);
  });

  it("sends the token from the fragment in the body, never in the URL", async () => {
    const { fetch, requests } = fakeFetch(() => json(200, {}));
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => "tok", fetch });

    await client.POST("/api/v1/invitations/preview", { body: { token: "secret-token" } });

    expect(requests[0]?.url).not.toContain("secret-token");
    expect(await requests[0]?.json()).toEqual({ token: "secret-token" });
  });
});

describe("unwrap", () => {
  it("returns the data on success", async () => {
    const { fetch } = fakeFetch(() =>
      json(200, { status: "healthy", environment: "dev", version: "1", timestamp: "t", correlationId: "c" }),
    );
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => null, fetch });

    const health = await unwrap(client.GET("/api/v1/health"));

    expect(health.status).toBe("healthy");
  });

  it("throws TempoApiError with the Problem code", async () => {
    const problem = {
      type: "about:blank",
      title: "Not found",
      status: 404,
      code: "invitation.not_found",
      correlationId: "corr-1",
    };
    const { fetch } = fakeFetch(() => json(404, problem, { "Content-Type": "application/problem+json" }));
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => "tok", fetch });

    const error = await unwrap(client.POST("/api/v1/invitations/preview", { body: { token: "x" } })).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TempoApiError);
    expect(error).toMatchObject({ status: 404, code: "invitation.not_found", correlationId: "corr-1", problem });
  });

  it("reads Retry-After on a 429", async () => {
    const problem = { type: "about:blank", title: "Too many", status: 429, code: "rate_limited", correlationId: "c" };
    const { fetch } = fakeFetch(() => json(429, problem, { "Retry-After": "120" }));
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => "tok", fetch });

    const error = await unwrap(client.POST("/api/v1/join", { body: { code: "x" } })).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 120 });
  });

  it("falls back to http.<status> when the body is not Problem Details", async () => {
    const { fetch } = fakeFetch(
      () => new Response("Bad gateway", { status: 502, headers: { "X-Correlation-Id": "edge-1" } }),
    );
    const client = createTempoClient({ baseUrl: "https://api.test", getAccessToken: () => null, fetch });

    const error = await unwrap(client.GET("/api/v1/health")).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 502,
      code: "http.502",
      problem: null,
      correlationId: "edge-1",
      retryAfterSeconds: null,
    });
  });
});
