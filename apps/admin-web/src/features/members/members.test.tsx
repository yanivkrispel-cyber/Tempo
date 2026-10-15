import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}/members`;

const member = (id: string, role: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userAccountId: `${id.slice(0, -2)}99`,
  email: `${role}@example.com`,
  displayName: `${role} person`,
  role,
  roles: [],
  personId: null,
  status: "active",
  joinedAt: "2026-10-14T08:00:00Z",
  version: "7",
  ...overrides,
});

const owner = member(studio.membershipId, "owner", { displayName: "דנה כהן" });
const admin = member("0199e5a1-0000-7000-8000-000000000101", "admin");
const staff = member("0199e5a1-0000-7000-8000-000000000102", "staff");
const client = member("0199e5a1-0000-7000-8000-000000000103", "client", { displayName: "נגה רוזן" });

function renderAs(
  role: "owner" | "admin" | "staff",
  routesForApi: Record<string, unknown> = {},
  auth = signedInAuth(),
) {
  const me = { ...sampleMe, memberships: [{ ...studio, role, roles: [], permissions: [] }] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: { items: [owner, admin, staff, client], nextBefore: null },
    ...routesForApi,
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/o/neshima"] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={api.fetch} />);
  return api;
}

async function rowOf(name: string) {
  const table = await screen.findByRole("table", { name: "חברי הסטודיו" });
  return within(table).getByRole("row", { name: new RegExp(name) });
}

async function openActions(name: string) {
  await userEvent.click(within(await rowOf(name)).getByRole("button", { name: `פעולות עבור ${name}` }));
  return screen.getByRole("menu");
}

describe("member actions", () => {
  it("lets the owner act on everyone but themselves", async () => {
    renderAs("owner");
    expect(within(await rowOf("דנה כהן")).queryByRole("button", { name: /פעולות/ })).not.toBeInTheDocument();
    const menu = await openActions("נגה רוזן");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["שינוי תפקיד", "השעיה", "הסרה מהסטודיו"]);
  });

  it("lets an admin act only on staff and clients", async () => {
    renderAs("admin");
    expect(within(await rowOf("admin person")).queryByRole("button", { name: /פעולות/ })).not.toBeInTheDocument();
    await openActions("staff person");
    await userEvent.click(screen.getByRole("menuitem", { name: "שינוי תפקיד" }));
    const dialog = screen.getByRole("dialog", { name: "שינוי תפקיד" });
    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["מתאמן"]);
  });

  it("shows no actions to staff, who cannot manage members", async () => {
    renderAs("staff");
    await rowOf("נגה רוזן");
    expect(screen.queryByRole("button", { name: /פעולות/ })).not.toBeInTheDocument();
  });

  it("changes a role with PUT /roles and the row's version in If-Match", async () => {
    const api = renderAs("owner", {
      [`PUT ${base}/${client.id}/roles`]: () => json({ ...client, role: "staff", version: "8" }),
    });
    await openActions("נגה רוזן");
    await userEvent.click(screen.getByRole("menuitem", { name: "שינוי תפקיד" }));
    const dialog = screen.getByRole("dialog", { name: "שינוי תפקיד" });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "תפקיד חדש" }), "staff");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("נגה רוזן: צוות")).toBeInTheDocument();
    const put = api.requests.findIndex((request) => request.method === "PUT");
    expect(api.requests[put]!.headers.get("If-Match")).toBe("7");
    expect(api.bodies[put]).toEqual({ roleIds: ["00000000-0000-7000-8000-000000000003"] });
    await waitFor(() =>
      expect(
        api.requests.filter((request) => request.method === "GET" && request.url.includes("/members")).length,
      ).toBe(2),
    );
  });

  it("explains a stale row instead of overwriting someone else's change", async () => {
    renderAs("owner", { [`PUT ${base}/${client.id}/roles`]: problem(409, "concurrency.conflict") });
    await openActions("נגה רוזן");
    await userEvent.click(screen.getByRole("menuitem", { name: "שינוי תפקיד" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "שמירה" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "מישהו אחר שינה את הנתונים בינתיים",
    );
  });

  it("asks the owner to sign in again before granting admin, and keeps the session", async () => {
    const redirect = vi.fn();
    const auth = signedInAuth({ redirect });
    renderAs("owner", { [`PUT ${base}/${client.id}/roles`]: problem(401, "auth.step_up_required") }, auth);
    await openActions("נגה רוזן");
    await userEvent.click(screen.getByRole("menuitem", { name: "שינוי תפקיד" }));
    const dialog = screen.getByRole("dialog", { name: "שינוי תפקיד" });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "תפקיד חדש" }), "admin");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent("לפעולה הזו צריך לאמת שוב את הזהות");
    expect(auth.isSignedIn).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "התחברות מחדש" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(new URL(redirect.mock.calls[0]![0] as string).pathname).toBe("/logout");
  });

  it("suspends a member", async () => {
    const api = renderAs("owner", { [`PATCH ${base}/${staff.id}`]: () => json({ ...staff, status: "suspended" }) });
    await openActions("staff person");
    await userEvent.click(screen.getByRole("menuitem", { name: "השעיה" }));
    expect(await screen.findByText("השעינו את staff person")).toBeInTheDocument();
    expect(api.bodies[api.requests.findIndex((request) => request.method === "PATCH")]).toEqual({
      status: "suspended",
    });
  });

  it("removes a member after confirming", async () => {
    const api = renderAs("owner", { [`DELETE ${base}/${client.id}`]: () => new Response(null, { status: 204 }) });
    await openActions("נגה רוזן");
    await userEvent.click(screen.getByRole("menuitem", { name: "הסרה מהסטודיו" }));
    const dialog = screen.getByRole("dialog", { name: "הסרה מהסטודיו" });
    expect(dialog).toHaveTextContent("אחרי ההסרה לא תהיה לנגה רוזן גישה לסטודיו נשימה");
    await userEvent.click(within(dialog).getByRole("button", { name: "הסרה" }));
    expect(await screen.findByText("הסרנו את נגה רוזן מהסטודיו")).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "DELETE" && request.url.endsWith(client.id))).toBe(true);
  });
});
