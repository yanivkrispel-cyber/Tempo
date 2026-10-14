import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { routes } from "./routes";

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} />);
  return router;
}

describe("client-web routes", () => {
  it("renders the member home at /", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("היי נגה");
  });

  it("shows the invitation when /invite has a token in the fragment, then drops the fragment", async () => {
    const router = renderAt("/invite#tok_123");
    expect(await screen.findByRole("heading", { name: "הוזמנת לסטודיו" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/invite");
    expect(router.state.location.hash).toBe("");
  });

  it("shows the join page when /join has a code in the fragment, then drops the fragment", async () => {
    const router = renderAt("/join#code-abc");
    expect(await screen.findByRole("heading", { name: "הצטרפות לסטודיו" })).toBeInTheDocument();
    expect(router.state.location.hash).toBe("");
  });

  it.each(["/invite", "/join", "/invite#"])("shows an invalid-link message at %s", (url) => {
    renderAt(url);
    expect(screen.getByRole("alert")).toHaveTextContent("הקישור לא תקין");
  });

  it("does not take the token from a path segment", () => {
    renderAt("/invite/tok_123");
    expect(screen.getByRole("heading", { name: "הדף לא נמצא" })).toBeInTheDocument();
  });
});
