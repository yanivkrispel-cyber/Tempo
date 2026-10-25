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
    expect(
      await screen.findByRole("heading", { level: 1, name: /^(בוקר טוב|צהריים טובים|ערב טוב), נגה$/ }),
    ).toBeInTheDocument();
  });

  it("groups the home in a main column and a side one: the next class and the week, then the pace (#485)", async () => {
    renderAt("/", 1280);
    const pace = await screen.findByRole("region", { name: "ההתקדמות שלך" });
    const week = screen.getByRole("region", { name: "השבוע שלך" });
    const main = screen.getByRole("main");
    expect(week.parentElement).not.toBe(main);
    expect(pace.parentElement).not.toBe(main);
    expect(pace.parentElement?.parentElement).toBe(main);
    expect(week.parentElement?.parentElement).toBe(main);
    expect(pace.parentElement).not.toBe(week.parentElement);
    // On a phone the wrappers are `display: contents`, so the reading order stays hero, week, pace.
    expect(week.compareDocumentPosition(pace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
