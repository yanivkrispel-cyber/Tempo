import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe, sampleProfile, signedInRoutes } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const consents = `POST /api/v1/organizations/${sampleMe.memberships[0]!.organization.id}/me/consents`;

function renderProfile(routesForApi: Record<string, unknown> = {}) {
  const api = apiStub({ ...signedInRoutes, ...routesForApi });
  render(<App router={createMemoryRouter(routes, { initialEntries: ["/profile"] })} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} today="2026-10-13" />);
  return api;
}

const recorded = (body: { purpose: string; channel: string; state: string }) => json({ id: "0199e5a1-0000-7000-8000-000000000999", method: "self", textVersion: "draft-2026-10-15", occurredAt: "2026-10-15T09:00:00Z", ...body }, 201);

describe("notification consent", () => {
  it("shows the studio's recorded choices; marketing is off until chosen", async () => {
    renderProfile();
    expect(await screen.findByRole("switch", { name: "התראות בדחיפה" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "תזכורות במייל" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "עדכונים ומבצעים במייל" })).not.toBeChecked();
    expect(screen.getByText("ההגדרות נשמרות בסטודיו נשימה.")).toBeInTheDocument();
  });

  it("records a withdrawal as a new choice with the text version", async () => {
    const api = renderProfile({ [consents]: () => recorded({ purpose: "reminders", channel: "push", state: "withdrawn" }) });
    await userEvent.click(await screen.findByRole("switch", { name: "התראות בדחיפה" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "התראות בדחיפה" })).not.toBeChecked());
    const post = api.requests.findIndex((request) => request.url.endsWith("/me/consents"));
    expect(api.bodies[post]).toEqual({ purpose: "reminders", channel: "push", state: "withdrawn", textVersion: "draft-2026-10-15" });
  });

  it("opts in to marketing by email", async () => {
    renderProfile({ [consents]: () => recorded({ purpose: "marketing", channel: "email", state: "granted" }) });
    await userEvent.click(await screen.findByRole("switch", { name: "עדכונים ומבצעים במייל" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "עדכונים ומבצעים במייל" })).toBeChecked());
  });

  it("puts the switch back and says so when the choice is not saved", async () => {
    renderProfile({ [consents]: problem(503, "http.503") });
    await userEvent.click(await screen.findByRole("switch", { name: "תזכורות במייל" }));
    expect(await screen.findByText("לא הצלחנו לשמור את הבחירה. נסו שוב.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "תזכורות במייל" })).toBeChecked();
  });

  it("has nothing to choose before the member joins a studio", async () => {
    renderProfile({ "POST /api/v1/session": { ...sampleMe, memberships: [] } });
    expect(await screen.findByText("ההגדרות יופיעו אחרי ההצטרפות לסטודיו.")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "התראות בדחיפה" })).not.toBeInTheDocument();
  });
});


describe("my details in the studio", () => {
  it("saves first name, last name and birth date with If-Match, clearing an emptied field", async () => {
    const profilePath = `/api/v1/organizations/${sampleMe.memberships[0]!.organization.id}/me/profile`;
    const api = renderProfile({ [`PATCH ${profilePath}`]: (request: Request) => request.json().then((body) => json({ ...sampleProfile, ...body, version: "3" })) });
    await userEvent.click(await screen.findByRole("button", { name: "הפרטים שלי" }));
    const dialog = screen.getByRole("dialog", { name: "הפרטים שלי" });
    expect(dialog).toHaveTextContent("מה שסטודיו נשימה רואה עליך");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "שם משפחה" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "תאריך לידה" }), "02.04.1990");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("הפרטים נשמרו")).toBeInTheDocument();
    const patch = api.requests.findIndex((request) => request.method === "PATCH");
    expect(api.requests[patch]!.headers.get("If-Match")).toBe("2");
    expect(api.bodies[patch]).toEqual({ givenName: "נגה", familyName: null, birthDate: "1990-04-02" });
  });
});

