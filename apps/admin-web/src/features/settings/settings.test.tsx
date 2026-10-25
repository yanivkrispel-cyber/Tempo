import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;

const organization = (overrides: Record<string, unknown> = {}) => ({
  ...studio.organization,
  countryCode: "IL",
  defaultLocale: "he-IL",
  timeZone: "Asia/Jerusalem",
  currencyCode: "ILS",
  joinLinkEnabled: true,
  createdAt: "2026-10-01T08:00:00Z",
  version: "3",
  ...overrides,
});

function renderAt(url: string, routesForApi: Record<string, unknown>, role: "owner" | "staff" = "owner") {
  const me = { ...sampleMe, memberships: [membershipAs(role)] };
  const api = apiStub({ "POST /api/v1/session": me, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

describe("studio settings", () => {
  it("sends only what changed, with If-Match, and refreshes the account", async () => {
    const api = renderAt("/o/neshima/settings", {
      [`GET ${base}`]: organization(),
      [`PATCH ${base}`]: () => json(organization({ displayName: "סטודיו נשימה עמוקה", version: "4" })),
    });
    const name = await screen.findByRole("textbox", { name: /שם הסטודיו/ });
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "הגדרות הסטודיו" })).toHaveTextContent("neshima");

    await userEvent.clear(name);
    await userEvent.type(name, "סטודיו נשימה עמוקה");
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("ההגדרות נשמרו")).toBeInTheDocument();
    const patch = api.requests.findIndex((request) => request.method === "PATCH");
    expect(api.requests[patch]!.headers.get("If-Match")).toBe("3");
    expect(api.bodies[patch]).toEqual({ displayName: "סטודיו נשימה עמוקה" });
    await waitFor(() =>
      expect(api.requests.filter((request) => request.url.endsWith("/api/v1/session")).length).toBe(2),
    );
  });

  it("indexes its sections, each link leading to its own section (#488)", async () => {
    renderAt("/o/neshima/settings", { [`GET ${base}`]: organization() });
    await screen.findByRole("textbox", { name: /שם הסטודיו/ });
    const index = screen.getByRole("navigation", { name: "חלקי ההגדרות" });
    const links = within(index).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      expect.arrayContaining(["פרטי הסטודיו", "מיתוג", "עמוד ציבורי", "התראות ותזכורות", "המנוי ל־Tempo"]),
    );
    for (const link of links) {
      const target = document.getElementById(link.getAttribute("href")!.slice(1));
      expect(target, link.textContent!).not.toBeNull();
      expect(target!.children.length, link.textContent!).toBeGreaterThan(0);
    }
    expect(within(index).getByRole("link", { name: "פרטי הסטודיו" })).toHaveAttribute("aria-current", "location");
    expect(document.getElementById("settings-studio")).toContainElement(
      screen.getByRole("region", { name: "הגדרות הסטודיו" }),
    );
  });

  it("leaves out of the index the sections staff cannot see", async () => {
    renderAt("/o/neshima/settings", { [`GET ${base}`]: organization() }, "staff");
    const index = await screen.findByRole("navigation", { name: "חלקי ההגדרות" });
    const labels = within(index)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toContain("פרטי הסטודיו");
    expect(labels).not.toContain("נוסחי ההודעות");
    expect(labels).not.toContain("המנוי ל־Tempo");
    for (const link of within(index).getAllByRole("link")) {
      expect(document.getElementById(link.getAttribute("href")!.slice(1))!.children.length).toBeGreaterThan(0);
    }
  });

  it("explains a conflict with someone else's change", async () => {
    renderAt("/o/neshima/settings", {
      [`GET ${base}`]: organization(),
      [`PATCH ${base}`]: problem(409, "concurrency.conflict"),
    });
    const name = await screen.findByRole("textbox", { name: /שם הסטודיו/ });
    await userEvent.type(name, "!");
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("מישהו אחר שינה את הנתונים בינתיים");
  });

  it("is not in the navigation for staff", async () => {
    renderAt("/o/neshima", { [`GET ${base}/members`]: { items: [], nextBefore: null } }, "staff");
    const nav = await screen.findByRole("navigation", { name: "ניהול הסטודיו" });
    expect(within(nav).queryByRole("link", { name: "הגדרות" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "יומן פעולות" })).not.toBeInTheDocument();
  });
});

describe("the Tempo plan", () => {
  const billing = (overrides: Record<string, unknown> = {}) => ({
    plan: {
      id: "0199e5a1-0000-7000-8000-000000000801",
      planKey: "pilot",
      displayName: "פיילוט",
      priceMinor: 0,
      currency: "ILS",
      interval: "month",
      entitlements: {},
    },
    state: "active",
    provider: "manual",
    currentPeriodEnd: null,
    entitlements: {},
    version: "1",
    ...overrides,
  });

  it("shows the plan and its state on the settings page", async () => {
    renderAt("/o/neshima/settings", { [`GET ${base}/billing`]: billing() });
    const card = await screen.findByRole("region", { name: "המנוי ל־Tempo" });
    expect(await within(card).findByText("פיילוט")).toBeInTheDocument();
    expect(card).toHaveTextContent("פעיל");
    expect(card).toHaveTextContent("ללא תשלום");
  });

  it("says when a studio is restricted, with the period end", async () => {
    renderAt("/o/neshima/settings", {
      [`GET ${base}/billing`]: billing({ state: "restricted", currentPeriodEnd: "2026-11-01T00:00:00Z" }),
    });
    const card = await screen.findByRole("region", { name: "המנוי ל־Tempo" });
    expect(await within(card).findByText("מוגבל")).toBeInTheDocument();
    expect(card).toHaveTextContent("התקופה הנוכחית עד 01.11.2026");
  });

  it("is not shown to staff, who cannot see billing", async () => {
    renderAt("/o/neshima/settings", {}, "staff");
    expect(await screen.findByRole("heading", { level: 1, name: "הגדרות הסטודיו" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "המנוי ל־Tempo" })).not.toBeInTheDocument();
  });
});

describe("audit log", () => {
  it("lists events with who and what, in Hebrew, and pages back", async () => {
    const event = (id: string, overrides: Record<string, unknown>) => ({
      id,
      occurredAt: "2026-10-15T09:05:00Z",
      actorType: "user",
      actorDisplayName: "דנה כהן",
      action: "invitation.created",
      targetType: "invitation",
      targetId: null,
      ...overrides,
    });
    const api = renderAt("/o/neshima/audit", {
      [`GET ${base}/audit-events`]: (request: Request) =>
        new URL(request.url).searchParams.get("before")
          ? json({
              items: [event("0199e5a1-0000-7000-8000-000000000703", { action: "something.new" })],
              nextBefore: null,
            })
          : json({
              items: [
                event("0199e5a1-0000-7000-8000-000000000701", {}),
                event("0199e5a1-0000-7000-8000-000000000702", {
                  actorType: "operator",
                  actorDisplayName: null,
                  action: "organization.viewed_by_operator",
                }),
              ],
              nextBefore: "0199e5a1-0000-7000-8000-000000000702",
            }),
    });
    const table = await screen.findByRole("table", { name: "יומן פעולות" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("דנה כהן");
    expect(rows[0]).toHaveTextContent("יצירת הזמנה");
    expect(rows[0]).toHaveTextContent("15.10.2026");
    expect(rows[1]).toHaveTextContent("צוות Tempo");
    expect(rows[1]).toHaveTextContent("צפייה של צוות Tempo");

    await userEvent.click(screen.getByRole("button", { name: "פעולות קודמות" }));
    expect(await screen.findByText("something.new")).toBeInTheDocument();
    expect(
      new URL(api.requests.filter((request) => request.url.includes("/audit-events"))[1]!.url).searchParams.get(
        "before",
      ),
    ).toBe("0199e5a1-0000-7000-8000-000000000702");
  });
});
