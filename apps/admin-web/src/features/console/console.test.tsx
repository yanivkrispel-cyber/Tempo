import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const membersPath = `GET /api/v1/organizations/${studio.organization.id}/members`;

const member = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: `0199e5a1-0000-7000-8000-0000000001${String(id).padStart(2, "0")}`,
  userAccountId: `0199e5a1-0000-7000-8000-0000000002${String(id).padStart(2, "0")}`,
  email: `member${id}@example.com`,
  displayName: `חבר ${id}`,
  role: "client",
  roles: [],
  personId: null,
  status: "active",
  joinedAt: "2026-10-14T08:00:00Z",
  version: "1",
  ...overrides
});

function renderAt(url: string, routesForApi: Record<string, unknown>) {
  const api = apiStub({ "POST /api/v1/session": sampleMe, ...routesForApi });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { router, api };
}

describe("choosing a studio", () => {
  it("lists the studios this account manages, not the ones it is a client of", async () => {
    const asClient = { ...studio, membershipId: "0199e5a1-0000-7000-8000-000000000009", role: "client", roles: [], permissions: [], organization: { ...studio.organization, id: "0199e5a1-0000-7000-8000-000000000010", slug: "other", displayName: "סטודיו אחר" } };
    renderAt("/select-organization", { "POST /api/v1/session": { ...sampleMe, memberships: [studio, asClient] } });
    const list = await screen.findByRole("navigation", { name: "בחירת סטודיו" });
    expect(within(list).getAllByRole("link")).toHaveLength(1);
    expect(within(list).getByRole("link")).toHaveAttribute("href", "/o/neshima");
    expect(within(list).getByRole("link")).toHaveTextContent("בעלים");
  });

  it("opens a new studio and goes into it", async () => {
    const created = { id: "0199e5a1-0000-7000-8000-000000000011", slug: "studio-ofri", displayName: "סטודיו עפרי" };
    const { router, api } = renderAt("/select-organization", {
      "POST /api/v1/session": { ...sampleMe, memberships: [] },
      "POST /api/v1/organizations": () => json({ ...created, status: "active", countryCode: "IL", defaultLocale: "he-IL", timeZone: "Asia/Jerusalem", currencyCode: "ILS", joinLinkEnabled: false, createdAt: "2026-10-15T08:00:00Z", version: "0" }, 201)
    });
    expect(await screen.findByText("עוד אין לך סטודיו לניהול")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: /שם הסטודיו/ }), "סטודיו עפרי");
    await userEvent.type(screen.getByRole("textbox", { name: /כתובת/ }), "Studio-Ofri");
    await userEvent.click(screen.getByRole("button", { name: "פתיחת הסטודיו" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/o/studio-ofri"));
    const post = api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/api/v1/organizations"));
    expect(api.bodies[post]).toEqual({ displayName: "סטודיו עפרי", slug: "studio-ofri", timeZone: "Asia/Jerusalem", defaultLocale: "he-IL" });
  });

  it("checks the address before sending and shows a taken address on the field", async () => {
    const { api } = renderAt("/select-organization", {
      "POST /api/v1/session": { ...sampleMe, memberships: [] },
      "POST /api/v1/organizations": problem(409, "organization.slug_taken")
    });
    await userEvent.type(await screen.findByRole("textbox", { name: /שם הסטודיו/ }), "סטודיו");
    await userEvent.type(screen.getByRole("textbox", { name: /כתובת/ }), "a-");
    await userEvent.click(screen.getByRole("button", { name: "פתיחת הסטודיו" }));
    expect(screen.getByText(/3 עד 40 תווים/)).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/api/v1/organizations"))).toBe(false);

    await userEvent.type(screen.getByRole("textbox", { name: /כתובת/ }), "b");
    await userEvent.click(screen.getByRole("button", { name: "פתיחת הסטודיו" }));
    expect(await screen.findByText("הכתובת הזו כבר תפוסה. נסו כתובת אחרת.")).toBeInTheDocument();
  });
});

describe("the console", () => {
  it("says when the studio in the address is not one the account manages", async () => {
    renderAt("/o/unknown", {});
    expect(await screen.findByRole("heading", { level: 1, name: "הסטודיו לא נמצא" })).toBeInTheDocument();
  });

  it("lists the members with role, status and join date, and marks the page in the navigation", async () => {
    renderAt("/o/neshima", {
      [membersPath]: { items: [member(1, { role: "owner", displayName: "דנה כהן" }), member(2, { status: "suspended", displayName: null })], nextBefore: null }
    });
    const table = await screen.findByRole("table", { name: "חברי הסטודיו" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("דנה כהן");
    expect(rows[0]).toHaveTextContent("בעלים");
    expect(rows[0]).toHaveTextContent("14.10.2026");
    expect(rows[1]).toHaveTextContent("member2");
    expect(within(rows[1]!).getByText("מושעה")).toHaveClass("tp-chip--warning");
    expect(screen.getByRole("link", { name: "חברי הסטודיו" })).toHaveAttribute("aria-current", "page");
  });

  it("loads the next page with the keyset cursor", async () => {
    const { api } = renderAt("/o/neshima", {
      [membersPath]: (request: Request) =>
        new URL(request.url).searchParams.get("before")
          ? json({ items: [member(3)], nextBefore: null })
          : json({ items: [member(1), member(2)], nextBefore: member(2).id })
    });
    await userEvent.click(await screen.findByRole("button", { name: "עוד חברים" }));
    expect(await screen.findByText("חבר 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עוד חברים" })).not.toBeInTheDocument();
    const urls = api.requests.filter((request) => request.url.includes("/members")).map((request) => new URL(request.url));
    expect(urls[0]!.searchParams.get("limit")).toBe("50");
    expect(urls[1]!.searchParams.get("before")).toBe(member(2).id);
  });
});
