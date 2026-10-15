import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import type { AuthClient } from "../../auth/authClient";
import { signedInAuth } from "../../test/auth";

// Tuesday 13 October 2026, the mockup's day.
const today = "2026-10-13";

function renderAt(url: string, auth: AuthClient = signedInAuth()) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <div dir="rtl">
      <App router={router} auth={auth} today={today} />
    </div>
  );
  return router;
}

describe("member home", () => {
  it("greets the member and shows the next booked class", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "היי נגה" })).toBeInTheDocument();
    expect(screen.getByText("יום שלישי · 13.10 · סטודיו נשימה")).toBeInTheDocument();

    const next = screen.getByRole("region", { name: "פילאטיס מכשירים" });
    expect(next).toHaveTextContent("השיעור הבא שלך");
    expect(next).toHaveTextContent("היום 17:30 · דנה · חדר המכשירים");
  });

  it("lists the chosen day's classes from the week strip, and says why a day is empty", async () => {
    renderAt("/");
    const week = await screen.findByRole("group", { name: "ימי השבוע" });
    expect(within(week).getAllByRole("button")).toHaveLength(7);
    expect(within(week).getByRole("button", { name: /13 באוקטובר, היום/ })).toHaveAttribute("aria-pressed", "true");

    const classes = screen.getByRole("region", { name: "השיעורים של היום" });
    expect(within(classes).getAllByRole("listitem")).toHaveLength(3);
    expect(within(classes).getByRole("link", { name: /פילאטיס מכשירים/ })).toHaveTextContent("נרשמת");
    expect(within(classes).getByRole("link", { name: /יין יוגה ונשימה/ })).toHaveTextContent("מלא · המתנה");

    await userEvent.click(within(week).getByRole("button", { name: /17 באוקטובר/ }));
    expect(screen.getByRole("region", { name: "השיעורים של יום שבת" })).toHaveTextContent("אין שיעורים בשבת");

    await userEvent.click(within(week).getByRole("button", { name: /12 באוקטובר/ }));
    expect(screen.getByText("היום הזה כבר עבר")).toBeInTheDocument();
  });

  it("marks the current page in the tab bar", async () => {
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "ניווט" });
    expect(within(nav).getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "הזמנות" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "הרשמה לשיעור" })).toHaveAttribute("href", "/book");
  });
});

describe("booking a class", () => {
  it("books a class through the sheet and shows the confirmation", async () => {
    renderAt("/book");
    expect(await screen.findByRole("heading", { level: 1, name: "מערכת שיעורים" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "היום" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "הרשמה ליוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה ליוגה בהריון" });
    expect(sheet).toHaveTextContent("היום · 19:00 · 60 דק׳");
    expect(sheet).toHaveTextContent("עם נועה");

    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ההרשמה" }));
    expect(await screen.findByText("נרשמת לשיעור. תזכורת תגיע שעתיים לפני.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const list = screen.getByRole("list", { name: "שיעורים, היום" });
    const row = within(list).getAllByRole("listitem")[1]!;
    expect(row).toHaveTextContent("נועה · נרשמת לשיעור");
    expect(within(row).getByText("נרשמת")).toHaveClass("tp-chip--success");
  });

  it("joins the waiting list of a full class", async () => {
    renderAt("/book");
    await userEvent.click(await screen.findByRole("button", { name: "להמתנה ליין יוגה ונשימה ב-20:15" }));
    expect(await screen.findByText("נכנסת לרשימת ההמתנה. נודיע לך כשיתפנה מקום.")).toBeInTheDocument();
    expect(await screen.findByText("במקום 2 בהמתנה")).toHaveClass("tp-chip--warning");
  });

  it("filters by kind and opens on the day it was linked with", async () => {
    renderAt("/book?day=2026-10-14");
    expect(await screen.findByRole("button", { name: "מחר" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "יוגה" }));
    expect(screen.getByRole("button", { name: "יוגה" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("ויניאסה יוגה");
  });
});

describe("my bookings", () => {
  it("lists upcoming bookings in order, with the waiting place", async () => {
    renderAt("/bookings");
    expect(await screen.findByRole("tab", { name: "קרובים · 3" })).toHaveAttribute("aria-selected", "true");

    const items = within(screen.getByRole("list", { name: "הזמנות קרובות" })).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".tp-class__title")?.textContent)).toEqual(["פילאטיס מכשירים", "פילאטיס כוח", "ויניאסה יוגה"]);
    expect(items[1]).toHaveTextContent("במקום 2 בהמתנה");
    expect(screen.getByRole("note")).toHaveTextContent("נרשום אותך אוטומטית");
  });

  it("shows past visits in the history tab", async () => {
    renderAt("/bookings");
    await userEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));
    const table = screen.getByRole("table", { name: "שיעורים קודמים" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(table).getByRole("row", { name: /12.10/ })).toHaveTextContent("הגעת");
    expect(within(table).getByText("בוטל בזמן")).toBeInTheDocument();
  });
});

describe("profile", () => {
  it("shows the member, the plan and the settings", async () => {
    renderAt("/profile");
    expect(await screen.findByRole("heading", { level: 1, name: "נגה רוזן" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "נגה רוזן" })).toHaveTextContent("נר");

    const plan = screen.getByRole("region", { name: "חודשי ללא הגבלה" });
    expect(plan).toHaveTextContent("מתחדש אוטומטית ב-18.10");
    expect(within(plan).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");

    expect(screen.getByRole("switch", { name: "התראות בדחיפה" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "תזכורת לפני שיעור" })).toHaveValue("2h");
    expect(screen.getByText("נחתמה")).toHaveClass("tp-chip--success");
  });

  it("says when an action is not built yet", async () => {
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: "עריכת פרטים" }));
    expect(await screen.findByText("האפשרות הזו תגיע בקרוב")).toBeInTheDocument();
  });

  it("signs out through the Hosted UI and lands on the sign-in page", async () => {
    const redirect = vi.fn();
    const router = renderAt("/profile", signedInAuth({ redirect }));
    await userEvent.click(await screen.findByRole("button", { name: "התנתקות" }));
    expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/tempo-test\.auth\..+\/logout\?client_id=test-client&logout_uri=/));
    expect(router.state.location.pathname).toBe("/login");
  });
});
