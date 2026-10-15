import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}/people`;
const personId = "0199e5a1-0000-7000-8000-000000000501";

const person = (overrides: Record<string, unknown> = {}) => ({
  id: personId,
  displayName: "נועה לוי",
  givenName: "נועה",
  familyName: "לוי",
  birthDate: "1990-04-02",
  status: "active",
  source: "staff_created",
  hasLogin: false,
  membershipId: null,
  primaryEmail: "noa@example.com",
  primaryPhone: "+972501234567",
  mergedIntoId: null,
  createdAt: "2026-10-15T08:00:00Z",
  version: "4",
  ...overrides
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...person(overrides),
  contactPoints: [
    { id: "0199e5a1-0000-7000-8000-000000000601", type: "email", value: "noa@example.com", isPrimary: true, verified: true, version: "1" },
    { id: "0199e5a1-0000-7000-8000-000000000602", type: "phone", value: "+972501234567", isPrimary: true, verified: false, version: "2" },
    { id: "0199e5a1-0000-7000-8000-000000000603", type: "phone", value: "+97231234567", isPrimary: false, verified: false, version: "3" }
  ],
  consents: [],
  relationships: []
});

function renderAt(url: string, routesForApi: Record<string, unknown>, permissions?: string[]) {
  const me = permissions ? { ...sampleMe, memberships: [{ ...studio, role: "staff", permissions }] } : sampleMe;
  const api = apiStub({ "POST /api/v1/session": me, ...routesForApi });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { router, api };
}

describe("people list", () => {
  it("shows people with local phone numbers, and searches a typed phone in E.164", async () => {
    const { api } = renderAt("/o/neshima/people", { [`GET ${base}`]: { items: [person()], nextBefore: null } });
    const table = await screen.findByRole("table", { name: "אנשים" });
    const row = within(table).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("נועה לוי");
    expect(row).toHaveTextContent("050-123-4567");
    expect(row).toHaveTextContent("הוספה בסטודיו");
    expect(within(row).getByRole("link", { name: "נועה לוי" })).toHaveAttribute("href", `/o/neshima/people/${personId}`);

    expect(new URL(api.requests.find((request) => request.url.includes("/people"))!.url).searchParams.get("status")).toBe("active");
    await userEvent.type(screen.getByRole("searchbox", { name: "חיפוש לפי שם, טלפון או מייל" }), "050-123");
    await waitFor(() => expect(api.requests.some((request) => new URL(request.url).searchParams.get("query") === "+97250123")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "בארכיון" }));
    await waitFor(() => expect(api.requests.some((request) => new URL(request.url).searchParams.get("status") === "archived")).toBe(true));
  });

  it("adds a walk-in with a name and a phone, then opens the record", async () => {
    const { router, api } = renderAt("/o/neshima/people", {
      [`GET ${base}`]: { items: [], nextBefore: null },
      [`POST ${base}`]: () => json(detail(), 201),
      [`GET ${base}/${personId}`]: detail()
    });
    await userEvent.click(await screen.findByRole("button", { name: "אדם חדש" }));
    const dialog = screen.getByRole("dialog", { name: "אדם חדש" });
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(within(dialog).getByText("צריך שם")).toBeInTheDocument();
    expect(within(dialog).getByText("צריך טלפון או מייל")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם לתצוגה/ }), "נועה לוי");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "טלפון" }), "050-1234567");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/o/neshima/people/${personId}`));
    const post = api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/people"));
    expect(api.bodies[post]).toEqual({ displayName: "נועה לוי", phone: "050-1234567" });
  });

  it("shows an invalid phone on its field", async () => {
    renderAt("/o/neshima/people", { [`GET ${base}`]: { items: [], nextBefore: null }, [`POST ${base}`]: problem(400, "contact_point.invalid_phone") });
    await userEvent.click(await screen.findByRole("button", { name: "אדם חדש" }));
    const dialog = screen.getByRole("dialog", { name: "אדם חדש" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם לתצוגה/ }), "דן");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "טלפון" }), "123");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await within(dialog).findByText("מספר הטלפון לא תקין")).toBeInTheDocument();
  });
});

describe("person card", () => {
  it("shows the details and contact points; the sign-in email cannot be edited", async () => {
    renderAt(`/o/neshima/people/${personId}`, { [`GET ${base}/${personId}`]: detail() });
    expect(await screen.findByRole("heading", { level: 1, name: "נועה לוי" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "פרטים" })).toHaveTextContent("02.04.1990");
    const contacts = screen.getByRole("region", { name: "פרטי קשר" });
    expect(within(contacts).getByText("050-123-4567")).toBeInTheDocument();
    expect(within(contacts).getByText("03-123-4567")).toBeInTheDocument();
    expect(within(contacts).queryByRole("button", { name: "מחיקת noa@example.com" })).not.toBeInTheDocument();
    expect(within(contacts).getByRole("button", { name: "הפיכת +97231234567 לראשי" })).toBeInTheDocument();
  });

  it("edits the names with If-Match and clears an emptied field", async () => {
    const { api } = renderAt(`/o/neshima/people/${personId}`, {
      [`GET ${base}/${personId}`]: detail(),
      [`PATCH ${base}/${personId}`]: () => json(detail({ displayName: "נועה ל.", familyName: null, version: "5" }))
    });
    await userEvent.click(await screen.findByRole("button", { name: "עריכה" }));
    const dialog = screen.getByRole("dialog", { name: "עריכת פרטים" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: /שם לתצוגה/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם לתצוגה/ }), "נועה ל.");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "שם משפחה" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByRole("heading", { level: 1, name: "נועה ל." })).toBeInTheDocument();
    const patch = api.requests.findIndex((request) => request.method === "PATCH");
    expect(api.requests[patch]!.headers.get("If-Match")).toBe("4");
    expect(api.bodies[patch]).toEqual({ displayName: "נועה ל.", givenName: "נועה", familyName: null, birthDate: "1990-04-02" });
  });

  it("adds a phone, makes another primary, and deletes one", async () => {
    const { api } = renderAt(`/o/neshima/people/${personId}`, {
      [`GET ${base}/${personId}`]: detail(),
      [`POST ${base}/${personId}/contact-points`]: () => json({ id: "0199e5a1-0000-7000-8000-000000000604", type: "phone", value: "+972521112222", isPrimary: false, verified: false, version: "0" }, 201),
      [`PATCH ${base}/${personId}/contact-points/0199e5a1-0000-7000-8000-000000000603`]: () => json({}),
      [`DELETE ${base}/${personId}/contact-points/0199e5a1-0000-7000-8000-000000000603`]: () => new Response(null, { status: 204 })
    });
    const contacts = await screen.findByRole("region", { name: "פרטי קשר" });
    await userEvent.type(within(contacts).getByRole("textbox", { name: "מספר" }), "052-1112222");
    await userEvent.click(within(contacts).getByRole("button", { name: "הוספה" }));
    await waitFor(() =>
      expect(api.bodies[api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/contact-points"))]).toEqual({ type: "phone", value: "052-1112222", isPrimary: false })
    );

    await userEvent.click(within(contacts).getByRole("button", { name: "הפיכת +97231234567 לראשי" }));
    await waitFor(() => expect(api.bodies[api.requests.findIndex((request) => request.method === "PATCH")]).toEqual({ isPrimary: true }));
    expect(api.requests.find((request) => request.method === "PATCH")!.headers.get("If-Match")).toBe("3");

    await userEvent.click(within(contacts).getByRole("button", { name: "מחיקת +97231234567" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "DELETE")).toBe(true));
  });

  it("is read-only for a member who can view people but not manage them", async () => {
    renderAt(`/o/neshima/people/${personId}`, { [`GET ${base}/${personId}`]: detail() }, ["organization.view", "members.view", "people.view"]);
    expect(await screen.findByRole("heading", { level: 1, name: "נועה לוי" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עריכה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "הוספת פרט קשר" })).not.toBeInTheDocument();
  });
});
