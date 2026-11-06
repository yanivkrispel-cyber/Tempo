import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const org = `/api/v1/organizations/${studio.organization.id}`;

/** A studio fresh from sign-up: nothing but its details. */
const empty = {
  [`GET ${org}/members`]: { items: [], nextBefore: null },
  [`GET ${org}/brand`]: { appName: "סטודיו נשימה", accentId: "sage", customized: false, version: "1" },
  [`GET ${org}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", joinLinkEnabled: false, version: "1" },
  [`GET ${org}/people`]: { items: [], nextBefore: null },
  [`GET ${org}/rooms`]: { items: [] },
  [`GET ${org}/class-types`]: { items: [] },
  [`GET ${org}/schedule-templates`]: { items: [] },
  [`GET ${org}/pass-products`]: { items: [] },
  [`GET ${org}/sessions`]: { items: [] },
};

/** Half way: a room, a class type and a pass, the brand set and the join link on. */
const half = {
  ...empty,
  [`GET ${org}/brand`]: { appName: "סטודיו נשימה", accentId: "rose", customized: true, version: "2" },
  [`GET ${org}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", joinLinkEnabled: true, version: "2" },
  [`GET ${org}/rooms`]: { items: [{ id: "r1", name: "האולם" }] },
  [`GET ${org}/class-types`]: { items: [{ id: "c1", name: "פילאטיס" }] },
  [`GET ${org}/pass-products`]: { items: [{ id: "p1", name: "כרטיסיית 10" }] },
};

const done = {
  ...half,
  [`GET ${org}/people`]: { items: [{ id: "x1" }], nextBefore: null },
  [`GET ${org}/schedule-templates`]: { items: [{ id: "t1" }] },
  [`GET ${org}/sessions`]: { items: [{ id: "s1", bookedCount: 1 }] },
};

function renderAs(role: "owner" | "staff", api: Record<string, unknown>) {
  const me = { ...sampleMe, memberships: [membershipAs(role)] };
  const stub = apiStub({ "POST /api/v1/session": me, ...api });
  const router = createMemoryRouter(routes, { initialEntries: ["/o/neshima"] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={stub.fetch} />);
  return stub;
}

const checklist = () => screen.findByRole("region", { name: "מכינים את הסטודיו" });
const titles = (region: HTMLElement) =>
  within(within(region).getByRole("list", { name: "שלבי ההכנה" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".tp-row__title")?.textContent);

describe("the owner's setup checklist", () => {
  it("starts a new studio at one of nine, with the brand on top and every step linking to its screen", async () => {
    renderAs("owner", empty);
    const region = await checklist();
    expect(within(region).getByText("1 מתוך 9 שלבים. הבא בתור: לוגו וצבעים.")).toBeInTheDocument();
    expect(within(region).getByRole("progressbar", { name: "ההתקדמות בהכנת הסטודיו" })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(titles(region)).toEqual([
      "לוגו וצבעים",
      "חדר",
      "סוג שיעור",
      "שיעורים קבועים",
      "כרטיסייה או מנוי",
      "מתאמנים",
      "קישור הצטרפות",
      "הרשמה ראשונה",
      "פרטי הסטודיו",
    ]);
    expect(within(region).getByRole("link", { name: /^חדר/ })).toHaveAttribute("href", "/o/neshima/rooms");
    expect(within(region).getByRole("link", { name: /^מתאמנים/ })).toHaveAttribute("href", "/o/neshima/people/import");
  });

  it("puts what is left first and marks what is done", async () => {
    renderAs("owner", half);
    const region = await checklist();
    expect(within(region).getByText("6 מתוך 9 שלבים. הבא בתור: שיעורים קבועים.")).toBeInTheDocument();
    expect(titles(region).slice(0, 4)).toEqual(["שיעורים קבועים", "מתאמנים", "הרשמה ראשונה", "פרטי הסטודיו"]);
    expect(within(region).getAllByText("בוצע")).toHaveLength(6);
  });

  it("hides when every step is done", async () => {
    const stub = renderAs("owner", done);
    await screen.findByRole("heading", { name: "חברי הסטודיו" });
    await waitFor(() => expect(stub.requests.some((r) => new URL(r.url).pathname.endsWith("/sessions"))).toBe(true));
    expect(screen.queryByRole("region", { name: "מכינים את הסטודיו" })).not.toBeInTheDocument();
  });

  it("closes for good in this browser when the owner dismisses it", async () => {
    renderAs("owner", empty);
    await userEvent.click(within(await checklist()).getByRole("button", { name: "סגירת רשימת ההכנה" }));
    expect(screen.queryByRole("region", { name: "מכינים את הסטודיו" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`tempo.setup-checklist.dismissed.${studio.organization.id}`)).toBe("1");
  });

  it("stays out of the way when a read fails", async () => {
    const { [`GET ${org}/rooms`]: _rooms, ...withoutRooms } = empty;
    renderAs("owner", withoutRooms);
    await screen.findByRole("heading", { name: "חברי הסטודיו" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "מכינים את הסטודיו" })).not.toBeInTheDocument());
  });

  it("is not shown to staff", async () => {
    const stub = renderAs("staff", empty);
    await screen.findByRole("heading", { name: "חברי הסטודיו" });
    expect(screen.queryByRole("region", { name: "מכינים את הסטודיו" })).not.toBeInTheDocument();
    expect(stub.requests.some((r) => new URL(r.url).pathname.endsWith("/brand"))).toBe(false);
  });
});
