import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { routes } from "../app/routes";
import { apiStub, problem, sampleMe } from "../test/api";
import { memoryStorage, signedInAuth, signedOutAuth } from "../test/auth";

// Built at runtime so the secret scan never sees a token-shaped literal (.gitleaksignore).
const token = "tok_" + "a".repeat(40);
const code = "join_" + "b".repeat(20);
const studio = { id: "0199e5a1-0000-7000-8000-000000000003", displayName: "סטודיו נשימה" };
const membership = sampleMe.memberships[0]!;

const invitation = {
  organization: studio,
  role: "client",
  invitedByDisplayName: "דנה כהן",
  expiresAt: "2026-10-22T09:00:00Z",
};

function renderAt(url: string, auth: AuthClient, routesForApi: Record<string, unknown>) {
  const api = apiStub({ "POST /api/v1/session": sampleMe, ...routesForApi });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={api.fetch} today="2026-10-13" />);
  return { router, api };
}

describe("/invite", () => {
  it("keeps the token through sign-in and shows the invitation when the visitor comes back", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    const first = renderAt(`/invite#${token}`, signedOutAuth({ redirect, flowStorage }), {});
    await userEvent.click(await screen.findByRole("button", { name: "התחברות" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({ returnTo: "/invite" });
    expect(first.api.requests).toHaveLength(0);
    first.router.dispose();

    // Back from the Hosted UI: /invite without a fragment, now signed in.
    const second = renderAt("/invite", signedInAuth(), { "POST /api/v1/invitations/preview": invitation });
    expect(await screen.findByRole("heading", { name: "הוזמנת לסטודיו נשימה" })).toBeInTheDocument();
    expect(screen.getByText(/הזמנה מאת דנה כהן · תפקיד: מתאמן · בתוקף עד 22.10.2026/)).toBeInTheDocument();
    const preview = second.api.requests.findIndex((request) => request.url.endsWith("/invitations/preview"));
    expect(second.api.bodies[preview]).toEqual({ token });
  });

  it("accepts, refreshes the account and opens the home screen", async () => {
    const { router, api } = renderAt(`/invite#${token}`, signedInAuth(), {
      "POST /api/v1/invitations/preview": invitation,
      "POST /api/v1/invitations/accept": membership,
    });
    await userEvent.click(await screen.findByRole("button", { name: "אישור ההצטרפות" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText("הצטרפת לסטודיו נשימה")).toBeInTheDocument();
    const accept = api.requests.findIndex((request) => request.url.endsWith("/invitations/accept"));
    expect(api.bodies[accept]).toEqual({ token });
    expect(api.requests.filter((request) => request.url.endsWith("/session")).length).toBe(2);
    expect(window.sessionStorage.getItem("tempo.client-web.pending-invite")).toBeNull();
  });

  it("says when the invitation is gone and forgets the token", async () => {
    renderAt(`/invite#${token}`, signedInAuth(), {
      "POST /api/v1/invitations/preview": problem(404, "invitation.not_found"),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("ההזמנה לא נמצאה");
    await waitFor(() => expect(window.sessionStorage.getItem("tempo.client-web.pending-invite")).toBeNull());
  });

  it("offers another account when the invitation was sent to a different email", async () => {
    renderAt(`/invite#${token}`, signedInAuth(), {
      "POST /api/v1/invitations/preview": invitation,
      "POST /api/v1/invitations/accept": problem(403, "invitation.email_mismatch"),
    });
    await userEvent.click(await screen.findByRole("button", { name: "אישור ההצטרפות" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ההזמנה נשלחה לכתובת מייל אחרת");
    expect(screen.getByRole("button", { name: "התחברות עם חשבון אחר" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אישור ההצטרפות" })).not.toBeInTheDocument();
  });

  it("asks to wait after too many attempts", async () => {
    renderAt(`/invite#${token}`, signedInAuth(), {
      "POST /api/v1/invitations/preview": problem(429, "rate_limited", { "Retry-After": "120" }),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("יותר מדי ניסיונות. נסו שוב בעוד 2 דקות.");
  });
});

describe("/join", () => {
  it("previews the studio, joins and opens the home screen", async () => {
    const { router, api } = renderAt(`/join#${code}`, signedInAuth(), {
      "POST /api/v1/join/preview": { organization: studio },
      "POST /api/v1/join": membership,
    });
    expect(await screen.findByRole("heading", { name: "הצטרפות לסטודיו נשימה" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "הצטרפות" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText("הצטרפת לסטודיו נשימה")).toBeInTheDocument();
    const join = api.requests.findIndex((request) => new URL(request.url).pathname === "/api/v1/join");
    expect(api.bodies[join]).toEqual({ code });
  });

  it("says when the link was replaced", async () => {
    renderAt(`/join#${code}`, signedInAuth(), { "POST /api/v1/join/preview": problem(404, "organization.not_found") });
    expect(await screen.findByRole("alert")).toHaveTextContent("הקישור לא תקין או שהוחלף");
    expect(screen.queryByRole("button", { name: "הצטרפות" })).not.toBeInTheDocument();
  });
});
