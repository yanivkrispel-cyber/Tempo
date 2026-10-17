import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, roleSummary, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";
import { screenWidth } from "../../test/screens";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;

let restore: (() => void) | undefined;
afterEach(() => restore?.());

function renderAt(url: string, role: "owner" | "staff", width: number) {
  restore = screenWidth(width);
  const permissions = role === "owner" ? [...permissionsFor.owner, "reports.view"] : permissionsFor.staff;
  const me = { ...sampleMe, memberships: [{ ...studio, roles: [roleSummary(role)], permissions }] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
    [`GET ${base}/members`]: { items: [], nextBefore: null },
    [`GET ${base}/sessions`]: { items: [] },
    [`GET ${base}/people`]: { items: [], nextBefore: null },
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { router };
}

describe("the console on a phone or an upright tablet (D15)", () => {
  it("keeps the menu in a drawer that the top bar opens and Escape closes", async () => {
    renderAt("/o/neshima", "owner", 390);
    const menuButton = await screen.findByRole("button", { name: "התפריט של הסטודיו" });
    const drawer = document.getElementById("console-menu")!;
    expect(drawer).not.toHaveAttribute("data-open");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(menuButton);
    expect(drawer).toHaveAttribute("data-open");
    expect(drawer).toHaveFocus();
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("navigation", { name: "ניהול הסטודיו" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(drawer).not.toHaveAttribute("data-open");
    expect(menuButton).toHaveFocus();
  });

  it("closes the drawer when a section is chosen", async () => {
    const { router } = renderAt("/o/neshima", "owner", 390);
    await userEvent.click(await screen.findByRole("button", { name: "התפריט של הסטודיו" }));
    const nav = screen.getByRole("navigation", { name: "ניהול הסטודיו" });
    await userEvent.click(within(nav).getByRole("link", { name: "אנשים" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/neshima/people"));
    expect(document.getElementById("console-menu")).not.toHaveAttribute("data-open");
  });

  it("puts the day, the week, people and reports on the bottom bar of an owner, and the rest behind עוד", async () => {
    renderAt("/o/neshima", "owner", 390);
    const bar = await screen.findByRole("navigation", { name: "קיצורי דרך" });
    expect(
      within(bar)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["היום", "מערכת", "אנשים", "דוחות"]);
    expect(within(bar).getByRole("link", { name: "היום" })).toHaveAttribute("href", "/o/neshima/today");

    await userEvent.click(within(bar).getByRole("button", { name: "עוד" }));
    expect(document.getElementById("console-menu")).toHaveAttribute("data-open");
  });

  it("gives a coach only the sections the role allows", async () => {
    renderAt("/o/neshima/today", "staff", 390);
    const bar = await screen.findByRole("navigation", { name: "קיצורי דרך" });
    expect(
      within(bar)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["היום", "מערכת", "אנשים"]);
  });

  it("keeps the side menu on a computer, with no top or bottom bar", async () => {
    renderAt("/o/neshima", "owner", 1280);
    expect(await screen.findByRole("navigation", { name: "ניהול הסטודיו" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "התפריט של הסטודיו" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "קיצורי דרך" })).not.toBeInTheDocument();
    expect(document.getElementById("console-menu")).not.toHaveClass("tp-drawer");
  });
});
