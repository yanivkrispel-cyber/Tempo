import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { apiStub, sampleMe } from "../test/api";
import { signedInAuth, signedOutAuth } from "../test/auth";
import { App } from "./App";
import { routes } from "./routes";

// Built at runtime so the secret scan never sees a token-shaped literal (.gitleaksignore).
const token = "tok_" + "a".repeat(40);
const members = { items: [], nextBefore: null };

function renderAt(url: string, auth: AuthClient = signedInAuth(), api = apiStub({ "POST /api/v1/session": sampleMe })) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={api.fetch} />);
  return router;
}

describe("admin-web routes", () => {
  it("loads every console page as its own chunk (board #511, S-3)", () => {
    const studio = (list: RouteObject[]): RouteObject | undefined =>
      list.flatMap((route) => (route.path === "/o/:slug" ? [route] : (studio(route.children ?? []) ?? []))).at(0);
    const pages = studio(routes)!.children!;
    expect(pages.length).toBeGreaterThan(15);
    for (const page of pages) expect(page.handle, page.path ?? "index").toHaveProperty("preload");
  });

  it("sends a signed-out visitor to /login", async () => {
    const router = renderAt("/", signedOutAuth());
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("ניהול הסטודיו ב־Tempo");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("opens the only studio straight away", async () => {
    const api = apiStub({
      "POST /api/v1/session": sampleMe,
      [`GET /api/v1/organizations/${sampleMe.memberships[0]!.organization.id}/members`]: members,
    });
    const router = renderAt("/", signedInAuth(), api);
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/neshima"));
    expect(await screen.findByRole("heading", { level: 1, name: "חברי הסטודיו" })).toBeInTheDocument();
  });

  it("asks a signed-out visitor to sign in for a staff invitation, then drops the fragment", async () => {
    const router = renderAt(`/invite#${token}`, signedOutAuth());
    expect(await screen.findByRole("heading", { name: "הוזמנת לצוות הסטודיו" })).toBeInTheDocument();
    expect(router.state.location.hash).toBe("");
  });

  it.each(["/invite", "/invite#", "/invite#tok_123"])("shows an invalid-link message at %s", (url) => {
    renderAt(url);
    expect(screen.getByRole("alert")).toHaveTextContent("הקישור לא תקין");
  });

  it("has no join page: join links belong to the client app", () => {
    renderAt("/join#code-abc");
    expect(screen.getByRole("heading", { name: "הדף לא נמצא" })).toBeInTheDocument();
  });

  it("does not take the token from a path segment", () => {
    renderAt(`/invite/${token}`);
    expect(screen.getByRole("heading", { name: "הדף לא נמצא" })).toBeInTheDocument();
  });
});
