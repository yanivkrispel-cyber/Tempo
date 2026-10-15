import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiProvider, useApi } from "../api/ApiProvider";
import { App } from "../app/App";
import { routes } from "../app/routes";
import { apiStub, signedInRoutes } from "../test/api";
import { memoryStorage, signedInAuth, signedOutAuth } from "../test/auth";
import type { AuthClient } from "./authClient";

function renderAt(url: string, auth: AuthClient | null, fetch: typeof globalThis.fetch = apiStub(signedInRoutes).fetch) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={fetch} />);
  return router;
}

describe("protected routes", () => {
  it("sends a signed-out visitor to /login and remembers the page", async () => {
    const router = renderAt("/bookings", signedOutAuth());
    expect(await screen.findByRole("heading", { name: "ברוכים הבאים ל־Tempo" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?returnTo=%2Fbookings");
  });

  it("starts the Hosted UI sign-in from /login with the remembered page", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    renderAt("/login?returnTo=%2Fbookings", signedOutAuth({ redirect, flowStorage }));
    await userEvent.click(screen.getByRole("button", { name: "התחברות" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({ returnTo: "/bookings" });
  });

  it("does not follow a returnTo that leaves the app", async () => {
    const router = renderAt("/login?returnTo=%2F%2Fevil.example", signedInAuth());
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("explains a missing sign-in configuration instead of offering a dead button", async () => {
    renderAt("/", null);
    expect(await screen.findByRole("status")).toHaveTextContent("ההתחברות לא מוגדרת");
    expect(screen.queryByRole("button", { name: "התחברות" })).not.toBeInTheDocument();
  });

  it("keeps /invite and /join public", async () => {
    renderAt("/invite#tok_QW5faW52aXRhdGlvbi10b2tlbi1mb3ItdGVzdHM", signedOutAuth());
    expect(await screen.findByRole("heading", { name: "הוזמנת לסטודיו" })).toBeInTheDocument();
  });
});

describe("/auth/callback", () => {
  it("completes the sign-in and opens the remembered page", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 })
    );
    const auth = signedOutAuth({ redirect, flowStorage, fetch });
    await auth.signIn("/bookings");
    const state = new URL(redirect.mock.calls[0]![0] as string).searchParams.get("state")!;

    const router = renderAt(`/auth/callback?code=c0de&state=${state}`, auth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/bookings"));
    expect(auth.isSignedIn).toBe(true);
  });

  it("shows an error for a forged state", async () => {
    renderAt("/auth/callback?code=c0de&state=forged", signedOutAuth());
    expect(await screen.findByRole("alert")).toHaveTextContent("ההתחברות נכשלה");
    expect(screen.getByRole("link", { name: "חזרה להתחברות" })).toHaveAttribute("href", "/login");
  });
});

describe("API client", () => {
  it("signs out locally when the API rejects the token", async () => {
    const auth = signedInAuth();
    const api = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    let call: Promise<unknown> | undefined;
    function Probe() {
      const client = useApi();
      call ??= client.GET("/api/v1/me");
      return null;
    }
    render(
      <ApiProvider baseUrl="https://api.test" auth={auth} fetch={api}>
        <Probe />
      </ApiProvider>
    );
    await call;
    const request = api.mock.calls[0]![0] as Request;
    expect(request.url).toBe("https://api.test/api/v1/me");
    expect(request.headers.get("Authorization")).toBe("Bearer access-1");
    expect(auth.isSignedIn).toBe(false);
  });
});
