import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000c${String(n).padStart(4, "0")}`;
const sessionId = id(1);

const session = {
  id: sessionId,
  templateId: null,
  localDate: "2026-10-14",
  // 17:30 to 18:20 in Israel.
  startsAt: "2026-10-14T14:30:00Z",
  endsAt: "2026-10-14T15:20:00Z",
  classType: { id: id(2), name: "פילאטיס מכשירים", category: "pilates", color: "rose" },
  instructor: { membershipId: id(3), displayName: "דנה אלון" },
  room: null,
  capacity: 2,
  bookedCount: 2,
  waitlistCount: 1,
  status: "scheduled",
  myBooking: null,
  passPreview: null,
  version: "1",
};
const entry = (n: number, name: string, overrides: Record<string, unknown> = {}) => ({
  bookingId: id(10 + n),
  person: { id: id(20 + n), displayName: name },
  status: "booked",
  waitlistPosition: null,
  passName: "כרטיסיית 10",
  // 21:04 in Israel on 10 October.
  bookedAt: "2026-10-10T18:04:00Z",
  ...overrides,
});
const booking = (n: number, name: string, overrides: Record<string, unknown> = {}) => ({
  id: id(10 + n),
  sessionId,
  person: { id: id(20 + n), displayName: name },
  status: "booked",
  waitlistPosition: null,
  lateCancel: false,
  cancelReason: null,
  pass: null,
  createdAt: "2026-10-10T18:04:00Z",
  version: "2",
  ...overrides,
});

function renderAt(routesForApi: Record<string, unknown>, now: string, permissions: string[] = permissionsFor.staff) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  const me = { ...sampleMe, memberships: [{ ...studio, role: "staff", roles: [], permissions }] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
    [`GET ${base}/sessions/${sessionId}`]: session,
    [`GET ${base}/booking-policy`]: {
      freeCancelHours: 6,
      waitlistCutoffHours: 2,
      bookingHorizonDays: 14,
      waitlistEnabled: true,
      version: "1",
    },
    ...routesForApi,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [`/o/neshima/schedule/sessions/${sessionId}`] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

afterEach(() => vi.useRealTimers());

const lastMove = (api: { requests: { url: string }[] }) =>
  api.requests.map((request) => request.url.endsWith("/move")).lastIndexOf(true);

const rosterOf = (booked: unknown[], waitlisted: unknown[] = []) => ({ session, booked, waitlisted });

describe("the roster", () => {
  it("lists who is booked and who waits, in line order", async () => {
    renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf(
          [entry(1, "שירה כהן"), entry(2, "נגה רוזן", { passName: "חודשי ללא הגבלה" })],
          [entry(3, "מאיה לוי", { status: "waitlisted", waitlistPosition: 1, passName: null })],
        ),
      },
      "2026-10-14T09:00:00Z",
    );
    const roster = await screen.findByRole("region", { name: "משתתפים" });
    const booked = await within(roster).findAllByRole("listitem");
    expect(booked.map((item) => within(item).getByRole("link").textContent)).toEqual(["שירה כהן", "נגה רוזן"]);
    expect(booked[0]).toHaveTextContent("נרשם.ה ב־10.10 · 21:04");
    expect(booked[1]).toHaveTextContent("חודשי ללא הגבלה");
    // Five hours before the class: too early for attendance.
    expect(within(roster).queryByRole("group", { name: /נוכחות/ })).not.toBeInTheDocument();

    await userEvent.click(within(roster).getByRole("tab", { name: "רשימת המתנה · 1" }));
    const waiting = within(roster).getAllByRole("listitem");
    expect(waiting).toHaveLength(1);
    expect(within(waiting[0]!).getByLabelText("מקום 1 בהמתנה")).toBeInTheDocument();
    expect(waiting[0]).toHaveTextContent("מאיה לוי");
  });

  it("marks attendance from half an hour before the class", async () => {
    let state = "booked";
    const api = renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: () => json(rosterOf([entry(1, "שירה כהן", { status: state })])),
        [`POST ${base}/bookings/${id(11)}/attendance`]: () => {
          state = "attended";
          return json(booking(1, "שירה כהן", { status: "attended" }));
        },
      },
      "2026-10-14T14:20:00Z",
    );
    const group = await screen.findByRole("group", { name: "נוכחות של שירה כהן" });
    await userEvent.click(within(group).getByRole("button", { name: "הגיע.ה" }));
    await waitFor(() =>
      expect(within(group).getByRole("button", { name: "הגיע.ה" })).toHaveAttribute("aria-pressed", "true"),
    );
    const post = api.requests.findIndex((request) => request.url.endsWith("/attendance"));
    expect(api.bodies[post]).toEqual({ state: "attended" });
  });

  it("moves a booked place to another class with a free place, and says when that class filled meanwhile", async () => {
    const other = (n: number, overrides: Record<string, unknown> = {}) => ({
      ...session,
      id: id(n),
      localDate: "2026-10-16",
      // 09:00 in Israel on 16 October.
      startsAt: "2026-10-16T06:00:00Z",
      endsAt: "2026-10-16T06:50:00Z",
      bookedCount: 1,
      capacity: 4,
      ...overrides,
    });
    let full = true;
    const api = renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([entry(1, "שירה כהן")]),
        [`GET ${base}/sessions`]: {
          items: [
            session,
            other(4),
            other(5, { bookedCount: 4 }),
            other(6, { status: "cancelled" }),
            // Already started: 11:00 in Israel today.
            other(7, { localDate: "2026-10-14", startsAt: "2026-10-14T08:00:00Z", endsAt: "2026-10-14T08:50:00Z" }),
          ],
        },
        [`POST ${base}/bookings/${id(11)}/move`]: () =>
          full ? ((full = false), problem(409, "session.full")) : json(booking(2, "שירה כהן", { sessionId: id(4) })),
      },
      "2026-10-14T09:00:00Z",
    );
    await userEvent.click(await screen.findByRole("button", { name: "העברה של שירה כהן לשיעור אחר" }));
    const dialog = screen.getByRole("dialog", { name: "העברה של שירה כהן לשיעור אחר" });
    const select = await within(dialog).findByRole("combobox", { name: /לאיזה שיעור/ });
    // Only the class that has not started, is not cancelled and has room.
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["בחרו שיעור", "פילאטיס מכשירים · 16.10 09:00 · 3 מקומות פנויים"]);
    await userEvent.selectOptions(select, id(4));
    await userEvent.click(within(dialog).getByRole("button", { name: "העברה" }));
    expect(await within(dialog).findByText("השיעור מלא.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "העברה" }));
    expect(await screen.findByText("שירה כהן הועבר.ה לשיעור פילאטיס מכשירים · 16.10 09:00")).toBeInTheDocument();
    expect(api.bodies[lastMove(api)]).toEqual({ sessionId: id(4) });
  });

  it("does not offer a move for a waiting place or after the class started", async () => {
    renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf(
          [entry(1, "שירה כהן")],
          [entry(3, "מאיה לוי", { status: "waitlisted", waitlistPosition: 1, passName: null })],
        ),
      },
      // Ten minutes into the class.
      "2026-10-14T14:40:00Z",
    );
    expect(await screen.findByRole("button", { name: "ביטול ההרשמה של שירה כהן" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^העברה של/ })).not.toBeInTheDocument();
  });

  it("cancels a late booking and returns the entry when staff choose to", async () => {
    let cancelled = false;
    const api = renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: () => json(rosterOf(cancelled ? [] : [entry(1, "שירה כהן")])),
        [`POST ${base}/bookings/${id(11)}/cancel`]: () => {
          cancelled = true;
          return json(booking(1, "שירה כהן", { status: "cancelled", lateCancel: true }));
        },
      },
      // 5.5 hours before the class, inside the 6-hour late window.
      "2026-10-14T09:00:00Z",
    );
    await userEvent.click(await screen.findByRole("button", { name: "ביטול ההרשמה של שירה כהן" }));
    const dialog = screen.getByRole("dialog", { name: "לבטל את ההרשמה של שירה כהן?" });
    expect(await within(dialog).findByText(/עבר חלון הביטול החינמי \(6 שעות לפני השיעור\)/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "להחזיר את הכניסה בכל זאת" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול ההרשמה" }));
    expect(await screen.findByText("ההרשמה של שירה כהן בוטלה")).toBeInTheDocument();
    const post = api.requests.findIndex((request) => request.url.endsWith("/cancel"));
    expect(api.bodies[post]).toEqual({ returnEntry: true });
    expect(await screen.findByText("עוד אין רשומים.")).toBeInTheDocument();
  });

  it("books a walk-in, who lands on the waitlist when the class is full", async () => {
    const api = renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([entry(1, "שירה כהן"), entry(2, "נגה רוזן")]),
        [`GET ${base}/people`]: {
          items: [
            {
              id: id(30),
              displayName: "רוני אברהם",
              status: "active",
              source: "staff_created",
              hasLogin: false,
              createdAt: "2026-10-01T08:00:00Z",
              version: "1",
            },
          ],
          nextBefore: null,
        },
        [`POST ${base}/sessions/${sessionId}/bookings`]: () =>
          json(booking(4, "רוני אברהם", { status: "waitlisted", waitlistPosition: 2 }), 201),
      },
      "2026-10-14T09:00:00Z",
    );
    await userEvent.click(await screen.findByRole("button", { name: "רישום מתאמן.ת" }));
    const dialog = screen.getByRole("dialog", { name: "רישום מתאמן.ת לשיעור" });
    await userEvent.type(within(dialog).getByRole("searchbox", { name: /חיפוש אדם/ }), "רונ");
    await userEvent.click(await within(dialog).findByRole("option", { name: "רוני אברהם" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "רישום" }));
    expect(await screen.findByText("השיעור מלא: רוני אברהם ברשימת ההמתנה, במקום 2")).toBeInTheDocument();
    const post = api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/bookings"));
    expect(api.bodies[post]).toEqual({ personId: id(30) });
  });

  it("says when the walk-in search fails, instead of no one found", async () => {
    renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([]),
        [`GET ${base}/people`]: problem(500, "http.500"),
      },
      "2026-10-14T09:00:00Z",
    );
    await userEvent.click(await screen.findByRole("button", { name: "רישום מתאמן.ת" }));
    const dialog = screen.getByRole("dialog", { name: "רישום מתאמן.ת לשיעור" });
    await userEvent.type(within(dialog).getByRole("searchbox", { name: /חיפוש אדם/ }), "רונ");
    expect(await within(dialog).findByText("החיפוש נכשל. נסו שוב.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(dialog).queryByText("לא נמצא אף אחד")).not.toBeInTheDocument();
  });

  it("does not offer walk-ins without people.view", async () => {
    renderAt(
      { [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([entry(1, "שירה כהן")]) },
      "2026-10-14T09:00:00Z",
      permissionsFor.staff.filter((key) => key !== "people.view"),
    );
    expect(await screen.findByText("שירה כהן")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "רישום מתאמן.ת" })).not.toBeInTheDocument();
  });

  it("writes a one-hour window in words, and still lets staff cancel when the policy fails", async () => {
    const api = renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([entry(1, "שירה כהן")]),
        [`GET ${base}/booking-policy`]: {
          freeCancelHours: 1,
          waitlistCutoffHours: 2,
          bookingHorizonDays: 14,
          waitlistEnabled: true,
          version: "1",
        },
      },
      // 10 minutes before the class.
      "2026-10-14T14:20:00Z",
    );
    await userEvent.click(await screen.findByRole("button", { name: "ביטול ההרשמה של שירה כהן" }));
    const dialog = screen.getByRole("dialog", { name: "לבטל את ההרשמה של שירה כהן?" });
    expect(await within(dialog).findByText(/\(שעה אחת לפני השיעור\)/)).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/booking-policy"))).toBe(true);
  });

  it("explains a policy that cannot load", async () => {
    renderAt(
      {
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([entry(1, "שירה כהן")]),
        [`GET ${base}/booking-policy`]: problem(500, "http.500"),
      },
      "2026-10-14T09:00:00Z",
    );
    await userEvent.click(await screen.findByRole("button", { name: "ביטול ההרשמה של שירה כהן" }));
    const dialog = screen.getByRole("dialog", { name: "לבטל את ההרשמה של שירה כהן?" });
    expect(
      await within(dialog).findByText(/לא הצלחנו לבדוק את חלון הביטול החינמי/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "להחזיר את הכניסה בכל זאת" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "ביטול ההרשמה" })).toBeEnabled();
  });
});

describe("the instructor rule", () => {
  // Neither bookings.manage nor attendance.mark: only being the class's instructor opens the roster.
  const viewer = ["organization.view", "members.view", "schedule.view"];

  it("lets the class's own instructor see the roster and mark attendance", async () => {
    renderAt(
      {
        [`GET ${base}/sessions/${sessionId}`]: {
          ...session,
          instructor: { membershipId: studio.membershipId, displayName: "דנה כהן" },
        },
        [`GET ${base}/sessions/${sessionId}/roster`]: rosterOf([entry(1, "שירה כהן")]),
      },
      "2026-10-14T14:20:00Z",
      viewer,
    );
    expect(await screen.findByRole("group", { name: "נוכחות של שירה כהן" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ביטול ההרשמה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "רישום מתאמן.ת" })).not.toBeInTheDocument();
  });

  it("hides the roster of someone else's class", async () => {
    const api = renderAt({}, "2026-10-14T14:20:00Z", viewer);
    expect(await screen.findByRole("heading", { name: "פילאטיס מכשירים", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "משתתפים" })).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/roster"))).toBe(false);
  });
});
