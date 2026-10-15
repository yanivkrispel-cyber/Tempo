import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const member = (id: string, role: string, displayName: string) => ({
  id, userAccountId: `${id.slice(0, -2)}99`, email: `${role}@example.com`, displayName, role, roles: [], personId: null, status: "active", joinedAt: "2026-10-14T08:00:00Z", version: "1"
});
const owner = member(studio.membershipId, "owner", "דנה כהן");
const admin = member("0199e5a1-0000-7000-8000-000000000101", "admin", "יעל לוי");
const staff = member("0199e5a1-0000-7000-8000-000000000102", "staff", "רון");
const transfer = { id: "0199e5a1-0000-7000-8000-000000000901", status: "pending", from: { membershipId: owner.id, displayName: null }, to: { membershipId: admin.id, displayName: null }, expiresAt: "2026-10-18T08:00:00Z", createdAt: "2026-10-15T08:00:00Z" };

function renderAs(role: "owner" | "admin", pending: "outgoing" | "incoming" | null, routesForApi: Record<string, unknown> = {}, auth = signedInAuth()) {
  const me = { ...sampleMe, memberships: [{ ...studio, role, roles: [], permissions: [], pendingOwnershipTransfer: pending ? { id: transfer.id, direction: pending, expiresAt: transfer.expiresAt } : null }] };
  const api = apiStub({ "POST /api/v1/session": me, [`GET ${base}/members`]: { items: [owner, admin, staff], nextBefore: null }, ...routesForApi });
  render(<App router={createMemoryRouter(routes, { initialEntries: ["/o/neshima"] })} auth={auth} apiUrl="https://api.test" fetch={api.fetch} />);
  return api;
}

async function actionsOf(name: string) {
  const table = await screen.findByRole("table", { name: "חברי הסטודיו" });
  await userEvent.click(within(within(table).getByRole("row", { name: new RegExp(name) })).getByRole("button", { name: `פעולות עבור ${name}` }));
  return within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent);
}

describe("owner transfer", () => {
  it("is offered to the owner only on an active admin", async () => {
    renderAs("owner", null);
    expect(await actionsOf("יעל לוי")).toContain("העברת הבעלות");
    await userEvent.keyboard("{Escape}");
    expect(await actionsOf("רון")).not.toContain("העברת הבעלות");
  });

  it("sends the offer to the admin and shows it as pending", async () => {
    const api = renderAs("owner", null, { [`POST ${base}/ownership-transfer`]: () => json(transfer, 201) });
    await actionsOf("יעל לוי");
    await userEvent.click(screen.getByRole("menuitem", { name: "העברת הבעלות" }));
    const dialog = screen.getByRole("dialog", { name: "העברת הבעלות" });
    await userEvent.click(within(dialog).getByRole("button", { name: "שליחת ההצעה" }));
    expect(await screen.findByText("ההצעה נשלחה ליעל לוי")).toBeInTheDocument();
    const post = api.requests.findIndex((request) => request.url.endsWith("/ownership-transfer"));
    expect(api.bodies[post]).toEqual({ toMembershipId: admin.id });
  });

  it("asks for a fresh sign-in when the API wants step-up", async () => {
    const redirect = vi.fn();
    renderAs("owner", null, { [`POST ${base}/ownership-transfer`]: problem(401, "auth.step_up_required") }, signedInAuth({ redirect }));
    await actionsOf("יעל לוי");
    await userEvent.click(screen.getByRole("menuitem", { name: "העברת הבעלות" }));
    const dialog = screen.getByRole("dialog", { name: "העברת הבעלות" });
    await userEvent.click(within(dialog).getByRole("button", { name: "שליחת ההצעה" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "התחברות מחדש" }));
    await waitFor(() => expect(new URL(redirect.mock.calls[0]![0] as string).pathname).toBe("/logout"));
  });

  it("lets the owner take back a pending offer, and offers no second one", async () => {
    const api = renderAs("owner", "outgoing", { [`DELETE ${base}/ownership-transfer`]: () => new Response(null, { status: 204 }) });
    expect(await screen.findByText(/הצעת העברת הבעלות ממתינה לתשובה עד 18.10.2026/)).toBeInTheDocument();
    expect(await actionsOf("יעל לוי")).not.toContain("העברת הבעלות");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "ביטול ההצעה" }));
    expect(await screen.findByText("ההצעה בוטלה")).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "DELETE" && request.url.endsWith("/ownership-transfer"))).toBe(true);
  });

  it("lets the admin accept the offer", async () => {
    const api = renderAs("admin", "incoming", { [`POST ${base}/ownership-transfer/accept`]: () => json({ ...studio, role: "owner" }) });
    expect(await screen.findByText(/הוצעה לך הבעלות על סטודיו נשימה/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "קבלת הבעלות" }));
    expect(await screen.findByText("מעכשיו הבעלות על סטודיו נשימה שלך")).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/ownership-transfer/accept"))).toBe(true);
  });

  it("explains an offer that no longer applies", async () => {
    renderAs("admin", "incoming", { [`POST ${base}/ownership-transfer/accept`]: problem(409, "ownership.transfer_stale") });
    await userEvent.click(await screen.findByRole("button", { name: "קבלת הבעלות" }));
    expect(await screen.findByText("התפקידים בסטודיו השתנו מאז ההצעה, ולכן היא בוטלה.")).toBeInTheDocument();
  });
});
