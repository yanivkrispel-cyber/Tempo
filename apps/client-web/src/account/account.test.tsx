import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { routes } from "../app/routes";
import { apiStub, json, problem, sampleMe } from "../test/api";
import { signedInAuth } from "../test/auth";

function renderAt(url: string, routesForApi: Record<string, unknown>) {
  const api = apiStub(routesForApi);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} today="2026-10-13" />);
  return { router, api };
}

describe("the account step after sign-in", () => {
  it("starts the session once with the access token before showing the member screens", async () => {
    const { api } = renderAt("/", { "POST /api/v1/session": sampleMe });
    expect(screen.getByText("טוענים את החשבון…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "היי נגה" })).toBeInTheDocument();

    // The session comes first and once; the home screen then reads the studio.
    expect(api.requests.filter((request) => request.url.endsWith("/api/v1/session"))).toHaveLength(1);
    expect(api.requests[0]!.method).toBe("POST");
    expect(api.requests[0]!.url).toBe("https://api.test/api/v1/session");
    expect(api.requests[0]!.headers.get("Authorization")).toBe("Bearer access-1");
  });

  it("explains a disabled account and offers a retry and sign-out", async () => {
    renderAt("/", { "POST /api/v1/session": problem(403, "account.disabled") });
    expect(await screen.findByRole("alert")).toHaveTextContent("החשבון הזה הושבת");
    expect(screen.getByRole("button", { name: "ניסיון נוסף" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "התנתקות" })).toBeInTheDocument();
  });
});

describe("home on the real account", () => {
  it("greets the member by their own first name and shows their studio, or none", async () => {
    renderAt("/", { "POST /api/v1/session": { ...sampleMe, displayName: "דנה כהן", memberships: [] } });
    expect(await screen.findByRole("heading", { level: 1, name: "היי דנה" })).toBeInTheDocument();
    expect(screen.queryByText(/סטודיו נשימה/)).not.toBeInTheDocument();
  });
});

describe("profile on the real account", () => {
  it("shows the account's name, email, studio and role", async () => {
    renderAt("/profile", {
      "POST /api/v1/session": { ...sampleMe, displayName: "דנה כהן", email: "dana@example.com" },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "דנה כהן" })).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
    const studio = screen.getByRole("region", { name: "הסטודיו שלך" });
    expect(studio).toHaveTextContent("סטודיו נשימה");
    expect(studio).toHaveTextContent("מתאמן");
    expect(within(studio).queryByRole("button", { name: "החלפת סטודיו" })).not.toBeInTheDocument();
  });

  it("falls back to the email's name and says when there is no studio yet", async () => {
    renderAt("/profile", {
      "POST /api/v1/session": { ...sampleMe, displayName: null, email: "new.member@example.com", memberships: [] },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "new.member" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "הסטודיו שלך" })).toHaveTextContent("עוד לא הצטרפת לסטודיו");
  });

  it("changes the display name with PATCH /me", async () => {
    const { api } = renderAt("/profile", {
      "POST /api/v1/session": sampleMe,
      "PATCH /api/v1/me": () => json({ ...sampleMe, displayName: "נגה ר." }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "עריכת פרטים" }));
    const dialog = screen.getByRole("dialog", { name: "עריכת פרטים" });
    const input = within(dialog).getByRole("textbox", { name: /שם לתצוגה/ });
    expect(input).toHaveValue("נגה רוזן");

    await userEvent.clear(input);
    await userEvent.type(input, "  נגה ר.  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByRole("heading", { level: 1, name: "נגה ר." })).toBeInTheDocument();
    expect(screen.getByText("השם עודכן")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const patch = api.requests.findIndex((request) => request.method === "PATCH");
    expect(api.bodies[patch]).toEqual({ displayName: "נגה ר." });
  });

  it("does not send an empty name", async () => {
    const { api } = renderAt("/profile", { "POST /api/v1/session": sampleMe });
    await userEvent.click(await screen.findByRole("button", { name: "עריכת פרטים" }));
    const dialog = screen.getByRole("dialog", { name: "עריכת פרטים" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: /שם לתצוגה/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(within(dialog).getByText("צריך שם לתצוגה")).toBeInTheDocument();
    await waitFor(() => expect(api.requests.every((request) => request.method !== "PATCH")).toBe(true));
  });
});
