import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import {
  card,
  createStudio,
  pastBookings,
  sessionIds,
  testNow,
  testToday,
  type StudioOptions,
} from "../../test/studio";

function renderAt(url: string, { auth = signedInAuth(), ...options }: StudioOptions & { auth?: AuthClient } = {}) {
  const studio = createStudio(options);
  const api = apiStub(studio.routes);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <div dir="rtl">
      <App router={router} auth={auth} apiUrl="https://api.test" fetch={api.fetch} today={testToday} now={testNow} />
    </div>,
  );
  return { router, studio, api };
}

const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".tp-class__title")?.textContent);

describe("member home", () => {
  it("greets the member and shows the next booked class in the studio's time", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "היי נגה" })).toBeInTheDocument();
    expect(screen.getByText("יום שלישי · 13.10 · סטודיו נשימה")).toBeInTheDocument();

    const next = await screen.findByRole("region", { name: "פילאטיס מכשירים" });
    expect(next).toHaveTextContent("השיעור הבא שלך");
    expect(next).toHaveTextContent("היום 13:00 · דנה אלון · חדר המכשירים");
    expect(within(next).getByRole("link", { name: "לפרטי השיעור" })).toHaveAttribute(
      "href",
      `/classes/${sessionIds.reformer}`,
    );
  });

  it("lists the chosen day's classes that have not ended, and says why a day is empty", async () => {
    renderAt("/");
    const week = await screen.findByRole("group", { name: "ימי השבוע" });
    expect(within(week).getAllByRole("button")).toHaveLength(7);
    expect(within(week).getByRole("button", { name: /13 באוקטובר, היום/ })).toHaveAttribute("aria-pressed", "true");

    const classes = screen.getByRole("region", { name: "השיעורים של היום" });
    await waitFor(() => expect(within(classes).getAllByRole("listitem")).toHaveLength(4));
    expect(within(classes).getByRole("link", { name: /פילאטיס מכשירים/ })).toHaveTextContent("נרשמת");
    expect(within(classes).getByRole("link", { name: /יין יוגה ונשימה/ })).toHaveTextContent("מלא");

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
  it("books through the sheet: the pass it uses, the free-cancel time, the entries left", async () => {
    const { api, studio } = renderAt("/book");
    expect(await screen.findByRole("heading", { level: 1, name: "מערכת שיעורים" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /13 באוקטובר, היום/ })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(await screen.findByRole("button", { name: "הרשמה ליוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה ליוגה בהריון" });
    expect(sheet).toHaveTextContent("היום · 19:00 · 60 דק׳");
    expect(sheet).toHaveTextContent("עם נועה");
    expect(sheet).toHaveTextContent("החדר הקטן");
    expect(sheet).toHaveTextContent("תנוצל כניסה אחת מכרטיסיית 10. אחרי ההרשמה נשארו 6 כניסות.");
    expect(sheet).toHaveTextContent("ביטול חינם עד היום 13:00.");

    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ההרשמה" }));
    expect(await screen.findByText("נרשמת לשיעור. בכרטיסיית 10 נשארו 6 כניסות.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const posted = api.requests.filter((request) => request.method === "POST" && request.url.endsWith("/bookings"));
    expect(posted.map((request) => new URL(request.url).pathname)).toEqual([
      expect.stringContaining(`/sessions/${sessionIds.prenatal}/bookings`),
    ]);
    expect(studio.passes[0]!.entriesLeft).toBe(6);

    const list = screen.getByRole("list", { name: "שיעורים, היום" });
    const row = within(list)
      .getByRole("link", { name: /יוגה בהריון/ })
      .closest("li")!;
    await waitFor(() => expect(within(row).getByText("נרשמת")).toHaveClass("tp-chip--success"));
  });

  it("warns in the sheet when booking now is already past the free-cancel time", async () => {
    renderAt("/book");
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לפילאטיס מזרן ב-17:30" }));
    expect(screen.getByRole("dialog", { name: "הרשמה לפילאטיס מזרן" })).toHaveTextContent(
      "עבר זמן הביטול החינמי: אם תבטלו, הכניסה לא תחזור.",
    );
  });

  it("says clearly when there is no valid pass, and does not offer to book", async () => {
    const { api } = renderAt("/book", { passes: [{ ...card, entriesUsed: 10, entriesLeft: 0 }] });
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה ליוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה ליוגה בהריון" });
    expect(within(sheet).getByRole("status")).toHaveTextContent("אין כרטיסייה בתוקף, פנו לסטודיו.");
    expect(within(sheet).queryByRole("button", { name: "אישור ההרשמה" })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "POST" && request.url.endsWith("/bookings"))).toBe(false);
  });

  it("explains the server's refusal in Hebrew", async () => {
    const { studio } = renderAt("/book");
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה ליוגה בהריון ב-19:00" }));
    // The card ran out on another device after the timetable loaded.
    studio.passes[0]!.entriesLeft = 0;
    await userEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
    expect(await screen.findByText("אין כרטיסייה בתוקף, פנו לסטודיו.")).toBeInTheDocument();
  });

  it("moves a week ahead up to the booking horizon, filters by kind and opens on a linked day", async () => {
    renderAt("/book?day=2026-10-14");
    expect(await screen.findByRole("button", { name: /14 באוקטובר/ })).toHaveAttribute("aria-pressed", "true");
    const tomorrow = await screen.findByRole("list", { name: "שיעורים, מחר" });
    expect(
      within(tomorrow)
        .getByRole("link", { name: /ויניאסה יוגה/ })
        .closest("li"),
    ).toHaveTextContent("נרשמת");

    expect(screen.getByRole("button", { name: "השבוע הקודם" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "השבוע הבא" }));
    expect(screen.getByRole("button", { name: /20 באוקטובר/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "השבוע הבא" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /21 באוקטובר/ }));
    expect(await screen.findByRole("button", { name: "הרשמה לפילאטיס מזרן ב-18:00" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "השבוע הקודם" }));
    await userEvent.click(screen.getByRole("button", { name: /13 באוקטובר/ }));
    await userEvent.click(await screen.findByRole("button", { name: "יוגה" }));
    expect(titles(await screen.findByRole("list", { name: "שיעורים, היום" }))).toEqual([
      "יוגה בהריון",
      "יין יוגה ונשימה",
    ]);
  });
});

describe("a class and cancelling", () => {
  it("cancels inside the free window: the entry comes back", async () => {
    const { studio } = renderAt(`/classes/${sessionIds.vinyasa}`);
    expect(await screen.findByRole("heading", { level: 1, name: "ויניאסה יוגה" })).toBeInTheDocument();
    expect(screen.getByText("מחר 14.10 · 07:00 עד 08:00")).toBeInTheDocument();
    expect(screen.getByText("נרשמת")).toHaveClass("tp-chip--success");
    expect(screen.getByRole("region", { name: "פרטי השיעור" })).toHaveTextContent("ביטול חינם עד מחר 01:00");

    await userEvent.click(screen.getByRole("button", { name: "ביטול הרשמה" }));
    const dialog = screen.getByRole("dialog", { name: "לבטל את ההרשמה?" });
    expect(dialog).toHaveAccessibleDescription(
      "עדיין בזמן הביטול החינמי (עד מחר 01:00), כך שהכניסה תחזור אליך. המקום יעבור למי שממתין.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול ההרשמה" }));

    expect(await screen.findByText("ההרשמה בוטלה בזמן, והכניסה חזרה אליך.")).toBeInTheDocument();
    expect(studio.passes[0]!.entriesLeft).toBe(8);
    expect(await screen.findByRole("button", { name: "הרשמה לשיעור" })).toBeInTheDocument();
  });

  it("warns before a late cancel and says the entry was used", async () => {
    const { studio } = renderAt(`/classes/${sessionIds.reformer}`);
    expect(await screen.findByRole("region", { name: "פרטי השיעור" })).toHaveTextContent(
      "עבר זמן הביטול החינמי: ביטול עכשיו לא יחזיר את הכניסה",
    );

    await userEvent.click(screen.getByRole("button", { name: "ביטול הרשמה" }));
    const dialog = screen.getByRole("dialog", { name: "לבטל את ההרשמה?" });
    expect(dialog).toHaveAccessibleDescription("עבר זמן הביטול החינמי (היום 07:00). אם תבטלו עכשיו, הכניסה לא תחזור.");
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול מאוחר" }));

    expect(await screen.findByText("ההרשמה בוטלה. זה ביטול מאוחר, ולכן הכניסה נוצלה.")).toBeInTheDocument();
    expect(studio.passes[0]!.entriesLeft).toBe(7);
  });

  it("keeps the booking when the member changes their mind", async () => {
    const { api } = renderAt(`/classes/${sessionIds.reformer}`);
    await userEvent.click(await screen.findByRole("button", { name: "ביטול הרשמה" }));
    await userEvent.click(screen.getByRole("button", { name: "השארת ההרשמה" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/cancel"))).toBe(false);
  });

  it("books from the class screen", async () => {
    renderAt(`/classes/${sessionIds.prenatal}`);
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה ליוגה בהריון" });
    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ההרשמה" }));
    expect(await screen.findByText("נרשמת לשיעור. בכרטיסיית 10 נשארו 6 כניסות.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ביטול הרשמה" })).toBeInTheDocument();
  });

  it("says when a class does not exist", async () => {
    renderAt("/classes/0199e5a1-0000-7000-8000-000000000399");
    expect(await screen.findByText("השיעור לא נמצא")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "למערכת השיעורים" })).toHaveAttribute("href", "/book");
  });
});

describe("my bookings", () => {
  it("lists upcoming bookings soonest first, each linked to its class", async () => {
    renderAt("/bookings");
    expect(await screen.findByRole("tab", { name: "קרובים · 2" })).toHaveAttribute("aria-selected", "true");

    const list = screen.getByRole("list", { name: "הזמנות קרובות" });
    expect(titles(list)).toEqual(["פילאטיס מכשירים", "ויניאסה יוגה"]);
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("היום · דנה אלון · חדר המכשירים");
    expect(within(items[1]!).getByRole("link")).toHaveAttribute("href", `/classes/${sessionIds.vinyasa}`);
  });

  it("shows past classes with what happened to the entry", async () => {
    renderAt("/bookings", { past: pastBookings() });
    await userEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));
    const table = await screen.findByRole("table", { name: "שיעורים קודמים" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("row", { name: /13.10/ })).toHaveTextContent("הגעת");
    expect(within(table).getByRole("row", { name: /12.10/ })).toHaveTextContent("בוטל באיחור · הכניסה נוצלה");
    expect(within(table).getByRole("row", { name: /08.10/ })).toHaveTextContent("השיעור בוטל");
  });

  it("says when there is no history yet", async () => {
    renderAt("/bookings");
    await userEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));
    expect(await screen.findByText("עוד אין שיעורים קודמים")).toBeInTheDocument();
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

    expect(await screen.findByRole("switch", { name: "התראות בדחיפה" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "תזכורת לפני שיעור" })).toHaveValue("2h");
    expect(screen.getByText("נחתמה")).toHaveClass("tp-chip--success");
  });

  it("says when an action is not built yet", async () => {
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: "קבלות ותשלומים" }));
    expect(await screen.findByText("האפשרות הזו תגיע בקרוב")).toBeInTheDocument();
  });

  it("signs out through the Hosted UI and lands on the sign-in page", async () => {
    const redirect = vi.fn();
    const { router } = renderAt("/profile", { auth: signedInAuth({ redirect }) });
    await userEvent.click(await screen.findByRole("button", { name: "התנתקות" }));
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/tempo-test\.auth\..+\/logout\?client_id=test-client&logout_uri=/),
    );
    expect(router.state.location.pathname).toBe("/login");
  });
});
