import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, problem } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import {
  bookingIdOf,
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

/** A toast whose message has inline markup (a pass name in its own <bdi>). */
const findToast = (text: string) =>
  screen.findByText(
    (_, element) => element?.parentElement?.classList.contains("tp-toast") === true && element.textContent === text,
  );

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

  it("says when my bookings could not be read, and retries", async () => {
    const studio = createStudio();
    const bookings = Object.keys(studio.routes).find((key) => key.endsWith("/me/bookings"))!;
    const read = studio.routes[bookings] as (request: Request) => Response;
    let fail = true;
    studio.routes[bookings] = (request: Request) => (fail ? problem(400, "http.400") : read(request));
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: ["/"] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={apiStub(studio.routes).fetch}
        today={testToday}
        now={testNow}
      />,
    );
    const next = await screen.findByRole("region", { name: "השיעור הבא שלך" });
    expect(await within(next).findByText("לא הצלחנו לטעון את ההזמנות שלך")).toBeInTheDocument();
    expect(screen.queryByText("אין לך שיעור קרוב")).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(within(next).getByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByRole("region", { name: "פילאטיס מכשירים" })).toHaveTextContent("היום 13:00");
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

    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה לשיעור יוגה בהריון" });
    expect(sheet).toHaveTextContent("היום · 19:00 · 60 דק׳");
    expect(sheet).toHaveTextContent("עם נועה");
    expect(sheet).toHaveTextContent("החדר הקטן");
    expect(sheet).toHaveTextContent("תנוצל כניסה אחת מהכרטיסייה כרטיסיית 10. אחרי ההרשמה נשארו 6 כניסות.");
    expect(sheet).toHaveTextContent("ביטול חינם עד היום 13:00.");

    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ההרשמה" }));
    expect(await findToast("נרשמת לשיעור. בכרטיסייה כרטיסיית 10 נשארו 6 כניסות.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const posted = api.requests.filter((request) => request.method === "POST" && request.url.endsWith("/bookings"));
    expect(posted.map((request) => new URL(request.url).pathname)).toEqual([
      expect.stringContaining(`/sessions/${sessionIds.prenatal}/bookings`),
    ]);
    expect(studio.passes[0]!.entriesLeft).toBe(6);

    const list = screen.getByRole("list", { name: "שיעורים, היום" });
    const link = within(list).getByRole("link", { name: /יוגה בהריון/ });
    expect(link).toHaveFocus();
    const row = link.closest("li")!;
    await waitFor(() => expect(within(row).getByText("נרשמת")).toHaveClass("tp-chip--success"));
  });

  it("warns in the sheet when booking now is already past the free-cancel time", async () => {
    renderAt("/book");
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור פילאטיס מזרן ב-17:30" }));
    expect(screen.getByRole("dialog", { name: "הרשמה לשיעור פילאטיס מזרן" })).toHaveTextContent(
      "עבר זמן הביטול החינמי: אם תבטלו, הכניסה לא תחזור.",
    );
  });

  it("says the membership is frozen, and until when, instead of offering to book", async () => {
    renderAt("/book", { frozenUntil: "2026-10-20" });
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה לשיעור יוגה בהריון" });
    expect(within(sheet).getByRole("status")).toHaveTextContent(
      "המנוי שלך מוקפא עד 20.10.2026, ולכן אי אפשר להירשם לשיעור הזה.",
    );
    expect(within(sheet).queryByRole("button", { name: "אישור ההרשמה" })).not.toBeInTheDocument();
  });

  it("says clearly when there is no valid pass, and does not offer to book", async () => {
    const { api } = renderAt("/book", { passes: [{ ...card, entriesUsed: 10, entriesLeft: 0 }] });
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה לשיעור יוגה בהריון" });
    expect(within(sheet).getByRole("status")).toHaveTextContent("אין כרטיסייה בתוקף, פנו לסטודיו.");
    expect(within(sheet).queryByRole("button", { name: "אישור ההרשמה" })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "POST" && request.url.endsWith("/bookings"))).toBe(false);
  });

  it("keeps the sheet open and explains the server's refusal in Hebrew", async () => {
    const { studio } = renderAt("/book");
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    // The card ran out on another device after the timetable loaded.
    studio.passes[0]!.entriesLeft = 0;
    await userEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה לשיעור יוגה בהריון" });
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "אין כרטיסייה או מנוי בתוקף לשיעור הזה. אם המנוי מוקפא, אי אפשר להירשם בימי ההקפאה. פנו לסטודיו.",
    );

    await userEvent.click(within(sheet).getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: "הרשמה לשיעור פילאטיס מזרן ב-18:00" })).toBeInTheDocument();

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
    expect(screen.getByRole("heading", { level: 1, name: "ויניאסה יוגה" })).toHaveFocus();
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

  it("adds a booked class to the calendar as an .ics file", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tempo-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const saved: HTMLAnchorElement[] = [];
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this);
    });
    const { api } = renderAt(`/classes/${sessionIds.reformer}`);
    await userEvent.click(await screen.findByRole("button", { name: "הוספה ליומן" }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    expect(saved[0]!.download).toBe("tempo-2026-10-13.ics");
    expect(saved[0]!.href).toBe("blob:tempo-test");
    expect(await (created.mock.calls[0]![0] as Blob).text()).toContain(`UID:${bookingIdOf(sessionIds.reformer)}@tempo`);
    expect(api.requests.some((request) => request.url.endsWith("/calendar.ics"))).toBe(true);
    vi.restoreAllMocks();
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
    const sheet = screen.getByRole("dialog", { name: "הרשמה לשיעור יוגה בהריון" });
    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ההרשמה" }));
    expect(await findToast("נרשמת לשיעור. בכרטיסייה כרטיסיית 10 נשארו 6 כניסות.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ביטול הרשמה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "יוגה בהריון" })).toHaveFocus();
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

  it("says when the studio moved a booking to another class", async () => {
    const past = pastBookings();
    past[2] = { ...past[2]!, cancelReason: "moved" };
    renderAt("/bookings", { past });
    await userEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));
    const table = await screen.findByRole("table", { name: "שיעורים קודמים" });
    expect(within(table).getByRole("row", { name: /08.10/ })).toHaveTextContent("הועבר לשיעור אחר");
  });

  it("says when there is no history yet", async () => {
    renderAt("/bookings");
    await userEvent.click(await screen.findByRole("tab", { name: "היסטוריה" }));
    expect(await screen.findByText("עוד אין שיעורים קודמים")).toBeInTheDocument();
  });
});

const promoted = () => [
  {
    id: "0199e5a1-0000-7000-8000-000000000a01",
    kind: "booking.promoted",
    data: { sessionId: sessionIds.vinyasa, bookingId: bookingIdOf(sessionIds.vinyasa) },
    createdAt: "2026-10-13T08:30:00Z",
    readAt: null,
  },
  // Kinds this app does not know yet are left out.
  {
    id: "0199e5a1-0000-7000-8000-000000000a02",
    kind: "billing.new_thing",
    data: {},
    createdAt: "2026-10-13T08:20:00Z",
    readAt: null,
  },
  {
    id: "0199e5a1-0000-7000-8000-000000000a03",
    kind: "waitlist.expired",
    data: { sessionId: sessionIds.morning, bookingId: bookingIdOf(sessionIds.morning) },
    createdAt: "2026-10-13T05:00:00Z",
    readAt: "2026-10-13T06:00:00Z",
  },
];

describe("the waitlist", () => {
  it("joins the waitlist of a full class without using an entry, and shows the place in line", async () => {
    const { studio } = renderAt("/book");
    await userEvent.click(await screen.findByRole("button", { name: "להמתנה לשיעור יין יוגה ונשימה ב-20:15" }));
    const sheet = screen.getByRole("dialog", { name: "רשימת ההמתנה לשיעור יין יוגה ונשימה" });
    expect(sheet).toHaveTextContent("בהמתנה לא נוצלת כניסה. אם יתפנה מקום, תנוצל כניסה אחת מהכרטיסייה כרטיסיית 10.");
    expect(sheet).toHaveTextContent("השיעור מלא. ממתין אחד לפניך.");

    await userEvent.click(within(sheet).getByRole("button", { name: "הצטרפות לרשימת ההמתנה" }));
    expect(
      await screen.findByText("נכנסת לרשימת ההמתנה, במקום 2 בהמתנה. אם יתפנה מקום נרשום אותך ונודיע לך."),
    ).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /יין יוגה ונשימה/ }).closest("li")!;
    await waitFor(() => expect(within(row).getByText("במקום 2 בהמתנה")).toHaveClass("tp-chip--warning"));
    expect(studio.passes[0]!.entriesLeft).toBe(7);
  });

  it("does not offer the waitlist when the studio has it off", async () => {
    renderAt(`/classes/${sessionIds.yin}`, { policy: { waitlistEnabled: false } });
    expect(await screen.findByRole("region", { name: "מקומות" })).toHaveTextContent(
      "14 מתוך 14 רשומים · מלא · 1 בהמתנה · רשימת ההמתנה סגורה",
    );
    expect(screen.queryByRole("button", { name: "הצטרפות לרשימת ההמתנה" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לשיעורים אחרים" })).toHaveAttribute("href", "/book?day=2026-10-13");
  });

  it("waits from the class screen, says until when a place can open, and leaves the waitlist", async () => {
    const { api } = renderAt(`/classes/${sessionIds.yin}`);
    await userEvent.click(await screen.findByRole("button", { name: "הצטרפות לרשימת ההמתנה" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "הצטרפות לרשימת ההמתנה" }));

    expect(
      await screen.findByText(
        "במקום 2 בהמתנה. אם יתפנה מקום עד היום 18:15, נרשום אותך אוטומטית, תנוצל כניסה ונודיע לך כאן.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("במקום 2 בהמתנה", { selector: ".tp-chip" })).toHaveClass("tp-chip--warning");

    await userEvent.click(screen.getByRole("button", { name: "יציאה מרשימת ההמתנה" }));
    const dialog = screen.getByRole("dialog", { name: "לצאת מרשימת ההמתנה?" });
    expect(dialog).toHaveAccessibleDescription(
      "המקום שלך בתור יעבור למי שאחריך. בהמתנה לא נוצלה כניסה, אז אין מה להחזיר.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "יציאה מההמתנה" }));
    expect(await screen.findByText("יצאת מרשימת ההמתנה.")).toBeInTheDocument();
    expect(
      api.requests.some((request) => request.url.endsWith(`/bookings/${bookingIdOf(sessionIds.yin)}/cancel`)),
    ).toBe(true);
  });

  it("lists a waitlist place in my bookings with a note on automatic promotion", async () => {
    renderAt(`/classes/${sessionIds.yin}`);
    await userEvent.click(await screen.findByRole("button", { name: "הצטרפות לרשימת ההמתנה" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "הצטרפות לרשימת ההמתנה" }));
    await screen.findByRole("button", { name: "יציאה מרשימת ההמתנה" });

    const nav = screen.getByRole("navigation", { name: "ניווט" });
    await userEvent.click(within(nav).getByRole("link", { name: "הזמנות" }));
    const list = await screen.findByRole("list", { name: "הזמנות קרובות" });
    expect(titles(list)).toEqual(["פילאטיס מכשירים", "יין יוגה ונשימה", "ויניאסה יוגה"]);
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("במקום 2 בהמתנה");
    expect(screen.getByRole("note")).toHaveTextContent("נרשום אותך אוטומטית ונשלח התראה");
  });
});

describe("promotion and the inbox", () => {
  it("tells the member on the home screen and the bell that a place opened", async () => {
    renderAt("/", { inbox: promoted() });
    expect(await screen.findByRole("link", { name: "התראות, אחת חדשה" })).toHaveAttribute("href", "/inbox");
    expect(screen.getByText(/התפנה מקום מרשימת ההמתנה, ונרשמת אוטומטית/)).toBeInTheDocument();
  });

  it("shows a studio's message about a class in its own words", async () => {
    renderAt("/inbox", {
      inbox: [
        {
          id: "0199e5a1-0000-7000-8000-000000000a05",
          kind: "session.message",
          data: { sessionId: sessionIds.vinyasa },
          text: "השיעור עובר לאולם הגדול",
          createdAt: "2026-10-13T08:45:00Z",
          readAt: null,
        },
      ],
    });
    const list = await screen.findByRole("list", { name: "התראות" });
    const [item] = within(list).getAllByRole("listitem");
    expect(item).toHaveTextContent("הודעה מהסטודיו על השיעור");
    expect(within(item!).getByText("השיעור עובר לאולם הגדול")).toHaveAttribute("dir", "auto");
    expect(within(item!).getByRole("link")).toHaveAttribute("href", `/classes/${sessionIds.vinyasa}`);
  });

  it("shows reminders, linking class ones to the class", async () => {
    renderAt("/inbox", {
      inbox: [
        {
          id: "0199e5a1-0000-7000-8000-000000000a06",
          kind: "reminder.class_soon",
          data: { sessionId: sessionIds.vinyasa, bookingId: bookingIdOf(sessionIds.vinyasa) },
          createdAt: "2026-10-13T08:50:00Z",
          readAt: null,
        },
        {
          id: "0199e5a1-0000-7000-8000-000000000a07",
          kind: "reminder.entries_low",
          data: { passId: "0199e5a1-0000-7000-8000-0000000000f1" },
          createdAt: "2026-10-13T08:30:00Z",
          readAt: null,
        },
      ],
    });
    const list = await screen.findByRole("list", { name: "התראות" });
    const [classSoon, entriesLow] = within(list).getAllByRole("listitem");
    expect(classSoon).toHaveTextContent("תזכורת: השיעור מתחיל בקרוב");
    expect(within(classSoon!).getByRole("link")).toHaveAttribute("href", `/classes/${sessionIds.vinyasa}`);
    expect(entriesLow).toHaveTextContent("נשארו מעט כניסות בכרטיסייה");
    expect(within(entriesLow!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("tells a member the studio moved the place, linking the new class", async () => {
    renderAt("/inbox", {
      inbox: [
        {
          id: "0199e5a1-0000-7000-8000-000000000a04",
          kind: "booking.moved",
          data: { sessionId: sessionIds.vinyasa, bookingId: bookingIdOf(sessionIds.vinyasa) },
          createdAt: "2026-10-13T08:40:00Z",
          readAt: null,
        },
      ],
    });
    const list = await screen.findByRole("list", { name: "התראות" });
    const [item] = within(list).getAllByRole("listitem");
    expect(item).toHaveTextContent("הסטודיו העביר אותך לשיעור אחר");
    expect(item).toHaveTextContent("לא נוצלה כניסה נוספת");
    expect(within(item!).getByRole("link")).toHaveAttribute("href", `/classes/${sessionIds.vinyasa}`);
  });

  it("lists the notifications it knows, and opening one marks it read and shows the class", async () => {
    const { api, studio, router } = renderAt("/inbox", { inbox: promoted() });
    const list = await screen.findByRole("list", { name: "התראות" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("התפנה מקום ונרשמת");
    await waitFor(() => expect(items[0]).toHaveTextContent("ויניאסה יוגה · מחר 07:00"));
    expect(within(items[0]!).getByText("חדש")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("לא התפנה מקום");
    expect(within(items[1]!).queryByText("חדש")).not.toBeInTheDocument();

    await userEvent.click(within(items[0]!).getByRole("link"));
    expect(router.state.location.pathname).toBe(`/classes/${sessionIds.vinyasa}`);
    expect(await screen.findByText("התפנה מקום, ונרשמת אוטומטית מרשימת ההמתנה.")).toBeInTheDocument();
    await waitFor(() => expect(studio.inbox[0]!.readAt).not.toBeNull());
    expect(api.requests.some((request) => request.method === "POST" && request.url.endsWith("/read"))).toBe(true);
  });

  it("marks a promoted booking in my bookings", async () => {
    renderAt("/bookings", { inbox: promoted() });
    const list = await screen.findByRole("list", { name: "הזמנות קרובות" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("נרשמת מההמתנה"));
  });

  it("says when there are no notifications", async () => {
    renderAt("/inbox");
    expect(await screen.findByText("אין התראות")).toBeInTheDocument();
  });
});

describe("passes", () => {
  it("shows the entries left over the timetable, and updates them after booking", async () => {
    renderAt("/book");
    const strip = await screen.findByRole("region", { name: "הכרטיסייה שלך" });
    expect(strip).toHaveTextContent("כרטיסיית 10 · נשארו 7 כניסות");
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    await userEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "הכרטיסייה שלך" })).toHaveTextContent("נשארו 6 כניסות"),
    );
  });

  it("says on the timetable when there is no valid pass", async () => {
    renderAt("/book", { passes: [] });
    expect(
      await screen.findByText("אין לך כרטיסייה או מנוי בתוקף. כדי להירשם לשיעורים, פנו לסטודיו."),
    ).toBeInTheDocument();
  });

  it("says a membership is frozen and when it resumes, and mentions an upcoming freeze", async () => {
    const membership = {
      ...card,
      product: { ...card.product, name: "מנוי חודשי", kind: "membership" as const, weeklyCap: null },
      entries: null,
      entriesUsed: 0,
      entriesLeft: null,
      endsOn: "2026-12-12",
    };
    renderAt("/profile", {
      passes: [
        {
          ...membership,
          freezes: [{ id: "0199e5a1-0000-7000-8000-000000000a01", startsOn: "2026-10-10", endsOn: "2026-10-20" }],
        },
        {
          ...membership,
          id: "0199e5a1-0000-7000-8000-000000000903",
          product: { ...membership.product, name: "מנוי בוקר" },
          freezes: [{ id: "0199e5a1-0000-7000-8000-000000000a02", startsOn: "2026-11-01", endsOn: "2026-11-14" }],
        },
      ],
    });
    const passes = await screen.findByRole("region", { name: "הכרטיסייה שלך" });
    const frozen = within(passes).getByRole("listitem", { name: "מנוי חודשי" });
    expect(frozen).toHaveTextContent("המנוי מוקפא. הוא חוזר להיות בתוקף ב־21.10.2026.");
    expect(frozen).toHaveTextContent("בתוקף עד 12.12.2026");
    const upcoming = within(passes).getByRole("listitem", { name: "מנוי בוקר" });
    expect(upcoming).toHaveTextContent("הקפאה מתוכננת: 01.11.2026 עד 14.11.2026");
    expect(upcoming).not.toHaveTextContent("המנוי מוקפא");
  });

  it("shows a membership's weekly cap and end date on the profile, and leaves out a voided pass", async () => {
    renderAt("/profile", {
      passes: [
        {
          ...card,
          product: { ...card.product, name: "מנוי חודשי", kind: "membership", weeklyCap: 3 },
          entries: null,
          entriesUsed: 0,
          entriesLeft: null,
          endsOn: "2026-11-12",
        },
        { ...card, id: "0199e5a1-0000-7000-8000-000000000902", status: "voided" },
      ],
    });
    const passes = await screen.findByRole("region", { name: "הכרטיסייה שלך" });
    expect(within(passes).getAllByRole("listitem")).toHaveLength(1);
    const membership = within(passes).getByRole("listitem", { name: "מנוי חודשי" });
    expect(membership).toHaveTextContent("עד 3 שיעורים בשבוע");
    expect(membership).toHaveTextContent("בתוקף עד 12.11.2026");
  });
});

describe("profile", () => {
  it("shows the member, the plan and the settings", async () => {
    renderAt("/profile");
    expect(await screen.findByRole("heading", { level: 1, name: "נגה רוזן" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "נגה רוזן" })).toHaveTextContent("נר");

    const passes = await screen.findByRole("region", { name: "הכרטיסייה שלך" });
    const pass = within(passes).getByRole("listitem", { name: "כרטיסיית 10" });
    expect(pass).toHaveTextContent("נשארו 7 כניסות");
    expect(pass).toHaveTextContent("בתוקף עד 31.12.2026");
    expect(within(pass).getByRole("progressbar", { name: "כניסות שנוצלו: 3 מתוך 10" })).toHaveAttribute(
      "aria-valuenow",
      "3",
    );

    expect(await screen.findByRole("switch", { name: "התראות בדחיפה" })).toBeChecked();
    expect(screen.getByRole("link", { name: /העדפות התראות/ })).toHaveAttribute("href", "/profile/notifications");
    expect(screen.getByText("נחתמה")).toHaveClass("tp-chip--success");
  });

  it("says when the passes could not be read, and retries", async () => {
    const studio = createStudio();
    const key = Object.keys(studio.routes).find((route) => route.endsWith("/me/passes"))!;
    const read = studio.routes[key] as () => Response;
    let fail = true;
    studio.routes[key] = () => (fail ? problem(400, "http.400") : read());
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: ["/profile"] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={apiStub(studio.routes).fetch}
        today={testToday}
        now={testNow}
      />,
    );
    const passes = await screen.findByRole("region", { name: "הכרטיסייה שלך" });
    expect(await within(passes).findByText("לא הצלחנו לטעון את הכרטיסיות")).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(passes).getByRole("button", { name: "נסו שוב" }));
    expect(await within(passes).findByRole("listitem", { name: "כרטיסיית 10" })).toHaveTextContent("נשארו 7 כניסות");
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
