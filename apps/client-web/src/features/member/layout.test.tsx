import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { screenWidth } from "../../test/screens";
import { createStudio, testNow } from "../../test/studio";

let restore: (() => void) | undefined;
afterEach(() => restore?.());

function renderAt(url: string, width: number) {
  restore = screenWidth(width);
  const studio = createStudio();
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={apiStub(studio.routes).fetch}
      now={testNow}
    />,
  );
}

describe("the member app on every screen (D15)", () => {
  it("keeps the bottom tab bar on a phone and an upright tablet", async () => {
    renderAt("/", 768);
    const nav = await screen.findByRole("navigation", { name: "ניווט" });
    expect(nav).toHaveClass("tp-tabbar");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent || link.getAttribute("aria-label")),
    ).toEqual(["בית", "מערכת", "הרשמה לשיעור", "הזמנות", "פרופיל"]);
  });

  it("puts the tabs, the inbox and booking in a side column on a computer", async () => {
    renderAt("/", 1280);
    const nav = await screen.findByRole("navigation", { name: "ניווט" });
    expect(nav).toHaveClass("tp-sidenav");
    expect(nav).toHaveTextContent("סטודיו נשימה");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["בית", "מערכת", "הזמנות", "התראות", "פרופיל", "הרשמה לשיעור"]);
    expect(within(nav).getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "התראות" })).toHaveAttribute("href", "/inbox");
    expect(document.querySelector(".tp-tabbar")).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "היי נגה" })).toBeInTheDocument();
  });
});
