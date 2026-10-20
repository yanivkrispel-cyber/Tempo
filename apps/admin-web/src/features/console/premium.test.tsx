import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, roleSummary, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";
import { screenWidth } from "../../test/screens";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000c${String(n).padStart(4, "0")}`;
const organization = { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" };
const owner = [...permissionsFor.owner, "reports.view"];

const session = (overrides: Record<string, unknown> = {}) => ({
  id: id(10),
  templateId: null,
  localDate: "2026-10-14",
  // 12:00 to 12:50 in Israel; the clock below says 11:50.
  startsAt: "2026-10-14T09:00:00Z",
  endsAt: "2026-10-14T09:50:00Z",
  classType: { id: id(1), name: "רפורמר בוקר", category: "pilates", color: "rose" },
  instructor: { membershipId: id(3), displayName: "נועה לוי" },
  room: { id: id(2), name: "חדר המכשירים", spotSelection: true },
  capacity: 4,
  bookedCount: 2,
  waitlistCount: 1,
  status: "scheduled",
  myBooking: null,
  passPreview: null,
  memberNote: null,
  version: "1",
  ...overrides,
});

const spot = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: id(40 + n),
  label: String(n),
  row: 0,
  col: n - 1,
  kind: "reformer",
  state: "free",
  bookingId: null,
  person: null,
  attendance: null,
  healthStatus: null,
  ...overrides,
});

const spots = {
  sessionId: id(10),
  roomId: id(2),
  spotSelection: true,
  rows: 1,
  cols: 4,
  windowSide: "start",
  mirrorFront: true,
  mySpotId: null,
  usualSpotId: null,
  spots: [
    spot(1, {
      state: "taken",
      bookingId: id(51),
      person: { id: id(61), displayName: "מאיה כהן" },
      attendance: "attended",
      healthStatus: "signed",
    }),
    spot(2, {
      state: "taken",
      bookingId: id(52),
      person: { id: id(62), displayName: "רוני אבן" },
      attendance: "booked",
      healthStatus: "missing",
    }),
    spot(3),
    spot(4, { state: "maintenance" }),
  ],
};

function renderAt(url: string, extra: Record<string, unknown> = {}, permissions = owner) {
  const me = {
    ...sampleMe,
    memberships: [{ ...studio, role: "owner" as const, roles: [roleSummary("owner")], permissions }],
  };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: organization,
    [`GET ${base}/sessions`]: { items: [session()] },
    [`GET ${base}/sessions/${id(10)}`]: session(),
    [`GET ${base}/sessions/${id(10)}/spots`]: spots,
    [`GET ${base}/sessions/${id(10)}/roster`]: { session: session(), booked: [], waitlisted: [] },
    [`GET ${base}/booking-policy`]: {
      freeCancelHours: 6,
      waitlistCutoffHours: 2,
      bookingHorizonDays: 14,
      waitlistEnabled: true,
      version: "1",
    },
    ...extra,
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { api, router };
}

beforeEach(() => {
  // 11:50 in Israel on Wednesday 14 October.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T08:50:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the owner's day (docs/33 section 9)", () => {
  const insights = {
    [`GET ${base}/insights/sales`]: {
      month: "2026-10",
      timeZone: "Asia/Jerusalem",
      soFarAgorot: 1_240_000,
      previousToDateAgorot: 1_000_000,
      forecastAgorot: 2_700_000,
      passesSold: 31,
      unpricedCount: 0,
      days: [
        { day: "2026-10-01", cumulativeAgorot: 100_000 },
        { day: "2026-10-14", cumulativeAgorot: 1_240_000 },
      ],
    },
    [`GET ${base}/insights/occupancy`]: {
      weekStart: "2026-10-11",
      timeZone: "Asia/Jerusalem",
      places: 78,
      capacity: 100,
      previousPlaces: 70,
      previousCapacity: 100,
      cells: [
        { day: "2026-10-11", part: "morning", places: 10, capacity: 10, fullWithWaitlist: true },
        { day: "2026-10-11", part: "evening", places: 4, capacity: 10, fullWithWaitlist: false },
      ],
    },
    [`GET ${base}/insights/suggestions`]: {
      items: [
        {
          kind: "passes_ending",
          count: 2,
          people: [
            { id: id(61), displayName: "מאיה כהן" },
            { id: id(62), displayName: "רוני אבן" },
          ],
          amountAgorot: 90_000,
        },
        // A story card (MK5) waits for its own screen (MO4): the "waiting for you" list leaves it out until then.
        { kind: "story_weekly", count: 6, people: [] },
      ],
    },
    [`GET ${base}/insights/activity`]: {
      items: [
        {
          kind: "booking.created",
          at: "2026-10-14T08:45:00Z",
          person: { id: id(61), displayName: "מאיה כהן" },
          className: "רפורמר בוקר",
          classStartsAt: "2026-10-14T09:00:00Z",
          spotLabel: "1",
        },
      ],
    },
  };

  it("shows the live class, the month's sales, the week's occupancy, what waits and what just happened", async () => {
    renderAt("/o/neshima/today", insights);

    const live = await screen.findByRole("region", { name: "רפורמר בוקר" });
    expect(within(live).getByText("מתחיל בעוד 10 דק׳")).toBeInTheDocument();
    expect(await within(live).findByText("הגיעו")).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: /מסך השיעור/ })).toHaveAttribute(
      "href",
      `/o/neshima/schedule/sessions/${id(10)}`,
    );

    const sales = await screen.findByRole("region", { name: "מכירות החודש" });
    expect(within(sales).getByText(/12,400/)).toBeInTheDocument();
    // The change says what it is compared with, in words, as in the mockup (O6).
    expect(within(sales).getByText(/יותר מספטמבר באותו זמן/)).toHaveTextContent("24% יותר מספטמבר באותו זמן");
    expect(within(sales).getByText(/צפי לסוף החודש/)).toBeInTheDocument();
    // The forecast continues the month's line as a dashed one, to the month's last day.
    expect(sales.querySelector("path[stroke-dasharray]")).not.toBeNull();

    const week = screen.getByRole("region", { name: "תפוסה השבוע" });
    expect(within(week).getByText("78%")).toBeInTheDocument();
    // Last week's share itself: "8% more" of a percentage would be read two ways.
    expect(within(week).getByText(/בשבוע שעבר/)).toHaveTextContent("70% בשבוע שעבר");
    expect(within(week).getByRole("cell", { name: "10 מתוך 10, מלא עם ממתינים" })).toBeInTheDocument();

    const waiting = await screen.findByRole("region", { name: "מחכה לך" });
    expect(within(waiting).getByText("2 כרטיסיות מסתיימות השבוע")).toBeInTheDocument();
    expect(within(waiting).getByRole("link", { name: "לרשימת האנשים" })).toHaveAttribute("href", "/o/neshima/people");

    const feed = await screen.findByRole("complementary", { name: "מה קורה בסטודיו" });
    expect(await within(feed).findByText("לפני 5 דק׳")).toBeInTheDocument();
    expect(within(feed).getByRole("link", { name: "מאיה כהן" })).toHaveAttribute("href", `/o/neshima/people/${id(61)}`);
  });

  it("greets the owner and opens the day from the top bar: search, what waits, and a new class (#378 item 1)", async () => {
    renderAt("/o/neshima/today", insights);

    // 11:50 in the studio.
    expect(await screen.findByRole("heading", { level: 1, name: "בוקר טוב, דנה" })).toBeInTheDocument();

    // The bell counts what waits, and it and the line under the greeting take the owner to it.
    const [bell, line] = await screen.findAllByRole("button", { name: "דבר אחד מחכה לך" });
    expect(bell).toHaveTextContent("1");
    await userEvent.click(bell!);
    const waiting = screen.getByRole("heading", { level: 2, name: "מחכה לך" });
    expect(waiting).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    await userEvent.click(line!);
    expect(waiting).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: /^חיפוש מתאמנת, שיעור או פעולה/ }));
    expect(await screen.findByRole("combobox", { name: "חיפוש אנשים, שיעורים ומסכים" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "שיעור חדש" }));
    expect(await screen.findByRole("dialog", { name: "שיעור חדש" })).toBeInTheDocument();
  });

  it("leaves the search to the phone's app bar", async () => {
    const restore = screenWidth(360);
    try {
      renderAt("/o/neshima/today", insights);
      await screen.findByRole("heading", { level: 1, name: "בוקר טוב, דנה" });
      expect(screen.queryByRole("button", { name: /חיפוש מתאמנת/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "חיפוש" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "שיעור חדש" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("keeps the numbers from someone without reports", async () => {
    const { api } = renderAt("/o/neshima/today", insights, permissionsFor.staff);
    expect(await screen.findByRole("region", { name: "השיעורים היום" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "מכירות החודש" })).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.url.includes("/insights/"))).toBe(false);
  });
});

describe("the room during a class (docs/33 section 8)", () => {
  it("shows who is on each spot, flags a missing health declaration, and marks attendance from the map", async () => {
    const { api } = renderAt("/o/neshima/schedule/sessions/" + id(10), {
      [`POST ${base}/bookings/${id(52)}/attendance`]: json({}),
    });
    const room = await screen.findByRole("region", { name: "החדר" });
    expect(await within(room).findByText("1 הגיעו מתוך 2 · 1 פנויים")).toBeInTheDocument();
    expect(within(room).getByRole("button", { name: "מכשיר 1, מאיה כהן, הגיע.ה" })).toBeInTheDocument();
    expect(within(room).getByRole("button", { name: "מכשיר 3, פנוי" })).toBeDisabled();

    await userEvent.click(within(room).getByRole("button", { name: "מכשיר 2, רוני אבן, אין הצהרת בריאות" }));
    expect(within(room).getByText("אין הצהרת בריאות", { selector: ".tp-banner *, .tp-banner" })).toBeInTheDocument();
    await userEvent.click(within(room).getByRole("button", { name: "הגיע.ה" }));
    await waitFor(() =>
      expect(api.requests.some((request) => request.url.endsWith(`/bookings/${id(52)}/attendance`))).toBe(true),
    );
    expect(api.bodies[api.requests.findIndex((request) => request.url.endsWith("/attendance"))]).toEqual({
      state: "attended",
    });
  });

  it("moves a person to a free spot", async () => {
    const { api } = renderAt("/o/neshima/schedule/sessions/" + id(10), {
      [`PUT ${base}/bookings/${id(52)}/spot`]: json({}),
    });
    const room = await screen.findByRole("region", { name: "החדר" });
    await userEvent.click(await within(room).findByRole("button", { name: /^מכשיר 2, רוני אבן/ }));
    await userEvent.click(within(room).getByRole("button", { name: "העברה למכשיר אחר" }));
    await userEvent.click(within(room).getByRole("button", { name: "מכשיר 3, פנוי" }));
    await waitFor(() => expect(api.requests.some((request) => request.url.endsWith("/spot"))).toBe(true));
    expect(api.bodies[api.requests.findIndex((request) => request.url.endsWith("/spot"))]).toEqual({
      spotId: id(43),
    });
  });

  it("saves the instructor's note for the members", async () => {
    const { api } = renderAt("/o/neshima/schedule/sessions/" + id(10), {
      [`PUT ${base}/sessions/${id(10)}/member-note`]: json(session({ memberNote: "הביאו גרביים" })),
    });
    const note = await screen.findByRole("region", { name: "הערה למתאמנים" });
    await userEvent.type(within(note).getByRole("textbox"), "הביאו גרביים");
    await userEvent.click(within(note).getByRole("button", { name: "שמירת ההערה" }));
    await waitFor(() => expect(api.requests.some((request) => request.url.endsWith("/member-note"))).toBe(true));
    expect(api.bodies[api.requests.findIndex((request) => request.url.endsWith("/member-note"))]).toEqual({
      note: "הביאו גרביים",
    });
  });
});

describe("the room layout (docs/33 section 3.2)", () => {
  it("adds a spot in an empty cell, sends one to maintenance, and saves the whole layout", async () => {
    const { api } = renderAt("/o/neshima/rooms", {
      [`GET ${base}/rooms`]: {
        items: [{ id: id(2), name: "חדר המכשירים", defaultCapacity: 4, status: "active", version: "1" }],
      },
      [`GET ${base}/rooms/${id(2)}/layout`]: {
        roomId: id(2),
        spotSelection: false,
        rows: 1,
        cols: 3,
        windowSide: null,
        mirrorFront: false,
        spots: [{ id: id(41), label: "1", row: 0, col: 0, kind: "reformer", status: "active" }],
        version: "1",
      },
      [`PUT ${base}/rooms/${id(2)}/layout`]: (request: Request) =>
        request.json().then((body) => json({ ...body, roomId: id(2), version: "2" })),
    });
    await userEvent.click(await screen.findByRole("button", { name: "מפת החדר חדר המכשירים" }));
    const dialog = await screen.findByRole("dialog", { name: /מפת החדר/ });
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: "המתאמנים בוחרים מכשיר כשהם נרשמים" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /משבצת ריקה, שורה 1 טור 2/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "מכשיר 1. הקשה מעבירה לתחזוקה" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    expect(api.bodies[api.requests.findIndex((request) => request.method === "PUT")]).toEqual({
      spotSelection: true,
      rows: 1,
      cols: 3,
      windowSide: null,
      mirrorFront: false,
      spots: [
        { id: id(41), label: "1", row: 0, col: 0, kind: "reformer", status: "maintenance" },
        { label: "2", row: 0, col: 1, kind: "reformer", status: "active" },
      ],
    });
  });

  it("starts a room never mapped with spot selection on and one reformer per place (D20)", async () => {
    const { api } = renderAt("/o/neshima/rooms", {
      [`GET ${base}/rooms`]: {
        items: [{ id: id(2), name: "חדר המכשירים", defaultCapacity: 5, status: "active", version: "1" }],
      },
      [`GET ${base}/rooms/${id(2)}/layout`]: {
        roomId: id(2),
        spotSelection: false,
        rows: null,
        cols: null,
        windowSide: null,
        mirrorFront: false,
        spots: [],
        version: "1",
      },
      [`PUT ${base}/rooms/${id(2)}/layout`]: (request: Request) =>
        request.json().then((body) => json({ ...body, roomId: id(2), version: "2" })),
    });
    await userEvent.click(await screen.findByRole("button", { name: "מפת החדר חדר המכשירים" }));
    const dialog = await screen.findByRole("dialog", { name: /מפת החדר/ });
    expect(await within(dialog).findByRole("checkbox", { name: "המתאמנים בוחרים מכשיר כשהם נרשמים" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    const body = api.bodies[api.requests.findIndex((request) => request.method === "PUT")] as {
      spotSelection: boolean;
      rows: number;
      cols: number;
      spots: { label: string; row: number; col: number }[];
    };
    expect(body).toMatchObject({ spotSelection: true, rows: 2, cols: 3 });
    expect(body.spots.map((spot) => [spot.label, spot.row, spot.col])).toEqual([
      ["1", 0, 0],
      ["2", 0, 1],
      ["3", 0, 2],
      ["4", 1, 0],
      ["5", 1, 1],
    ]);
  });
});

describe("the command palette (P8)", () => {
  it("opens on Ctrl K, finds people and classes, and opens the chosen one", async () => {
    const { router } = renderAt("/o/neshima/today", {
      [`GET ${base}/search`]: {
        people: [{ id: id(61), displayName: "מאיה כהן" }],
        sessions: [{ id: id(10), className: "רפורמר בוקר", startsAt: "2026-10-14T09:00:00Z", instructorName: null }],
      },
    });
    await screen.findByRole("heading", { level: 1, name: "בוקר טוב, דנה" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", { name: "חיפוש אנשים, שיעורים ומסכים" });
    await userEvent.type(box, "מא");
    expect(await screen.findByRole("option", { name: /מאיה כהן/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /רפורמר בוקר.*12:00/ })).toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/o/neshima/people/${id(61)}`));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says the search failed instead of showing an empty result, and keeps Tab inside the palette", async () => {
    renderAt("/o/neshima/today", {
      [`GET ${base}/search`]: json({ title: "error" }, 500),
    });
    await screen.findByRole("heading", { level: 1, name: "בוקר טוב, דנה" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", { name: "חיפוש אנשים, שיעורים ומסכים" });
    await userEvent.type(box, "מא");
    // The search retries once before it gives up.
    expect(await screen.findByText("החיפוש לא הצליח. נסו שוב.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText("לא נמצא כלום.")).not.toBeInTheDocument();

    await userEvent.tab();
    expect(box).toHaveFocus();
  });
});
