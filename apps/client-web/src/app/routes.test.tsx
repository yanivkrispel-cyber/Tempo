import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { apiStub, signedInRoutes } from "../test/api";
import { signedInAuth, signedOutAuth } from "../test/auth";
import { App } from "./App";
import { routes } from "./routes";

// Built at runtime so the secret scan never sees a token-shaped literal (.gitleaksignore).
const token = "tok_" + "a".repeat(40);
const code = "join_" + "b".repeat(20);

function renderAt(url: string, auth: AuthClient = signedInAuth()) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={apiStub(signedInRoutes).fetch} />);
  return router;
}

describe("client-web routes", () => {
  it("renders the member home at /", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("היי נגה");
  });

  it("asks a signed-out visitor to sign in for an invitation, then drops the fragment", async () => {
    const router = renderAt(`/invite#${token}`, signedOutAuth());
    expect(await screen.findByRole("heading", { name: "הוזמנת לסטודיו" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/invite");
    expect(router.state.location.hash).toBe("");
  });

  it("asks a signed-out visitor to sign in to join, then drops the fragment", async () => {
    const router = renderAt(`/join#${code}`, signedOutAuth());
    expect(await screen.findByRole("heading", { name: "הצטרפות לסטודיו" })).toBeInTheDocument();
    expect(router.state.location.hash).toBe("");
  });

  it.each(["/invite", "/join", "/invite#", "/invite#tok_123", "/join#short"])("shows an invalid-link message at %s", (url) => {
    renderAt(url);
    expect(screen.getByRole("alert")).toHaveTextContent("הקישור לא תקין");
  });

  it("does not take the token from a path segment", () => {
    renderAt(`/invite/${token}`);
    expect(screen.getByRole("heading", { name: "הדף לא נמצא" })).toBeInTheDocument();
  });
});
