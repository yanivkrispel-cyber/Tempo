import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;

const invitation = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  email: "new.coach@example.com",
  role: "staff",
  status: "pending",
  expiresAt: "2026-10-22T08:00:00Z",
  createdAt: "2026-10-15T08:00:00Z",
  invitedBy: { membershipId: studio.membershipId, displayName: "דנה כהן" },
  ...overrides,
});

const organization = (joinLinkEnabled: boolean) => ({
  ...studio.organization,
  countryCode: "IL",
  defaultLocale: "he-IL",
  timeZone: "Asia/Jerusalem",
  currencyCode: "ILS",
  joinLinkEnabled,
  createdAt: "2026-10-01T08:00:00Z",
  version: "3",
});

function renderAs(
  role: "owner" | "admin" | "staff",
  routesForApi: Record<string, unknown> = {},
  url = "/o/neshima/invitations",
) {
  const me = { ...sampleMe, memberships: [membershipAs(role)] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: organization(false),
    [`GET ${base}/invitations`]: { items: [invitation("0199e5a1-0000-7000-8000-000000000301")], nextBefore: null },
    [`GET ${base}/members`]: { items: [], nextBefore: null },
    ...routesForApi,
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return api;
}

describe("invitations", () => {
  it("lists pending invitations by default and all of them on request", async () => {
    const api = renderAs("owner", {
      [`GET ${base}/invitations`]: (request: Request) =>
        new URL(request.url).searchParams.get("status") === "pending"
          ? json({ items: [invitation("0199e5a1-0000-7000-8000-000000000301")], nextBefore: null })
          : json({
              items: [
                invitation("0199e5a1-0000-7000-8000-000000000301"),
                invitation("0199e5a1-0000-7000-8000-000000000302", { status: "accepted", email: "old@example.com" }),
              ],
              nextBefore: null,
            }),
    });
    const table = await screen.findByRole("table", { name: "הזמנות במייל" });
    const row = within(table).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("new.coach@example.com");
    expect(row).toHaveTextContent("צוות");
    expect(row).toHaveTextContent("ממתינה");
    expect(row).toHaveTextContent("22.10.2026");
    expect(row).toHaveTextContent("דנה כהן");

    await userEvent.click(screen.getByRole("button", { name: "כולן" }));
    expect(await screen.findByText("old@example.com")).toBeInTheDocument();
    const lists = api.requests
      .filter((request) => request.url.includes("/invitations"))
      .map((request) => new URL(request.url).searchParams.get("status"));
    expect(lists).toEqual(["pending", null]);
  });

  it("creates an invitation and shows its link once", async () => {
    const api = renderAs("owner", {
      [`POST ${base}/invitations`]: () =>
        json(
          {
            ...invitation("0199e5a1-0000-7000-8000-000000000303", { email: "yoga@example.com", role: "admin" }),
            link: "http://localhost:5173/invite#abc",
          },
          201,
        ),
    });
    await userEvent.click(await screen.findByRole("button", { name: "הזמנה חדשה" }));
    const dialog = screen.getByRole("dialog", { name: "הזמנה חדשה" });
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת הזמנה" }));
    expect(within(dialog).getByText("כתובת מייל לא תקינה")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /מייל/ }), " yoga@example.com ");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "תפקיד" }), "admin");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת הזמנה" }));

    const done = await screen.findByRole("dialog", { name: "ההזמנה מוכנה" });
    expect(within(done).getByRole("textbox", { name: "קישור ההזמנה" })).toHaveValue("http://localhost:5173/invite#abc");
    const post = api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/invitations"));
    expect(api.bodies[post]).toEqual({ email: "yoga@example.com", role: "admin" });
  });

  it("does not offer the admin role to an admin", async () => {
    renderAs("admin");
    await userEvent.click(await screen.findByRole("button", { name: "הזמנה חדשה" }));
    const options = within(screen.getByRole("dialog"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["מתאמן", "צוות"]);
  });

  it("revokes a pending invitation", async () => {
    const api = renderAs("owner", {
      [`DELETE ${base}/invitations/0199e5a1-0000-7000-8000-000000000301`]: () => new Response(null, { status: 204 }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "ביטול ההזמנה ל־new.coach@example.com" }));
    expect(await screen.findByText("ההזמנה ל־new.coach@example.com בוטלה")).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("creates the join link, shows it once, and turns it off", async () => {
    let enabled = false;
    const api = renderAs("owner", {
      [`GET ${base}`]: () => json(organization(enabled)),
      [`PUT ${base}/join-link`]: () => {
        enabled = true;
        return json({ link: "http://localhost:5174/join#code", createdAt: "2026-10-15T08:00:00Z" });
      },
      [`DELETE ${base}/join-link`]: () => {
        enabled = false;
        return new Response(null, { status: 204 });
      },
    });
    const card = await screen.findByRole("region", { name: "קישור הצטרפות למתאמנים" });
    expect(await within(card).findByText("כבוי")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "יצירת קישור" }));
    expect(await within(card).findByRole("textbox", { name: "קישור ההצטרפות החדש" })).toHaveValue(
      "http://localhost:5174/join#code",
    );
    expect(await within(card).findByText("פעיל")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "כיבוי הקישור" }));
    expect(await screen.findByText("קישור ההצטרפות כובה")).toBeInTheDocument();
    await waitFor(() => expect(within(card).queryByRole("textbox")).not.toBeInTheDocument());
    expect(
      api.requests.filter((request) => request.url.endsWith("/join-link")).map((request) => request.method),
    ).toEqual(["PUT", "DELETE"]);
  });

  it("shows the section in the navigation only to members who can invite", async () => {
    renderAs("staff", {}, "/o/neshima");
    const nav = await screen.findByRole("navigation", { name: "ניהול הסטודיו" });
    expect(within(nav).queryByRole("link", { name: "הזמנות" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "חברי הסטודיו" })).toBeInTheDocument();
  });
});
