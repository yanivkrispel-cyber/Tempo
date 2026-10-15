import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, membershipAs, problem, roleSummary, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const membersPath = `/api/v1/organizations/${studio.organization.id}/members`;

const client = {
  id: "0199e5a1-0000-7000-8000-000000000103",
  userAccountId: "0199e5a1-0000-7000-8000-000000000199",
  email: "client@example.com",
  displayName: "נגה רוזן",
  role: "client",
  roles: [roleSummary("client")],
  personId: null,
  status: "active",
  joinedAt: "2026-10-14T08:00:00Z",
  version: "1",
};

function renderAt(routesForApi: Record<string, unknown>, membership: Record<string, unknown> = membershipAs("owner")) {
  const api = apiStub({
    "POST /api/v1/session": { ...sampleMe, memberships: [membership] },
    [`GET ${membersPath}`]: { items: [client], nextBefore: null },
    ...routesForApi,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: ["/o/neshima"] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

const warnings = () => screen.queryAllByRole("status").filter((node) => node.classList.contains("tp-banner--warning"));

describe("console notices", () => {
  it("sends an owner without MFA to two-step sign-in setup", async () => {
    renderAt({ [`GET ${membersPath}`]: problem(403, "auth.mfa_required") });
    const link = await screen.findByRole("link", { name: "הפעלת אימות דו־שלבי" }, { timeout: 3000 });
    expect(link).toHaveAttribute("href", "/account/security");
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toHaveTextContent("כדי לנהל את הסטודיו צריך להפעיל בחשבון אימות דו־שלבי.");
  });

  it("says when the studio's subscription is restricted, and still lists the members", async () => {
    renderAt({}, membershipAs("owner", { subscriptionState: "restricted" }));
    expect(await screen.findByRole("table", { name: "חברי הסטודיו" })).toBeInTheDocument();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toHaveTextContent("המנוי של הסטודיו מושהה");
  });

  it.each([undefined, null, "active", "trialing"])("shows nothing for subscription state %s", async (state) => {
    renderAt({}, membershipAs("owner", { subscriptionState: state }));
    expect(await screen.findByRole("table", { name: "חברי הסטודיו" })).toBeInTheDocument();
    expect(warnings()).toHaveLength(0);
  });

  it("explains a write refused with 402 billing.restricted", async () => {
    renderAt({ [`PATCH ${membersPath}/${client.id}`]: problem(402, "billing.restricted") });
    const table = await screen.findByRole("table", { name: "חברי הסטודיו" });
    const row = within(table).getByRole("row", { name: /נגה רוזן/ });
    await userEvent.click(within(row).getByRole("button", { name: "פעולות עבור נגה רוזן" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "השעיה" }));
    expect(await screen.findByText(/המנוי של הסטודיו מושהה/)).toBeInTheDocument();
  });
});
