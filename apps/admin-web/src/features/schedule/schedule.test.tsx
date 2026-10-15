import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000a${String(n).padStart(4, "0")}`;

const organization = { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" };
const reformer = {
  id: id(1),
  name: "פילאטיס מכשירים",
  category: "pilates",
  color: "rose",
  defaultMinutes: 50,
  description: null,
  status: "active",
  version: "1",
};
const room = { id: id(2), name: "חדר המכשירים", defaultCapacity: 8, status: "active", version: "1" };
const dana = {
  id: id(3),
  userAccountId: id(30),
  email: "dana@example.com",
  displayName: "דנה אלון",
  role: "staff",
  roles: [],
  status: "active",
  joinedAt: "2026-10-01T08:00:00Z",
  version: "1",
};

const session = (overrides: Record<string, unknown> = {}) => ({
  id: id(10),
  templateId: id(20),
  localDate: "2026-10-14",
  // 17:30 in Israel (UTC+3 until 25 October).
  startsAt: "2026-10-14T14:30:00Z",
  endsAt: "2026-10-14T15:20:00Z",
  classType: { id: reformer.id, name: reformer.name, category: "pilates", color: "rose" },
  instructor: { membershipId: dana.id, displayName: "דנה אלון" },
  room: { id: room.id, name: room.name },
  capacity: 8,
  bookedCount: 5,
  waitlistCount: 0,
  status: "scheduled",
  myBooking: null,
  passPreview: null,
  version: "4",
  ...overrides,
});

const template = (overrides: Record<string, unknown> = {}) => ({
  id: id(20),
  classTypeId: reformer.id,
  weekday: 3,
  localStart: "17:30",
  minutes: 50,
  instructorMembershipId: dana.id,
  roomId: room.id,
  capacity: 8,
  validFrom: "2026-10-01",
  validUntil: null,
  version: "2",
  ...overrides,
});

const scheduleRoutes = {
  [`GET ${base}`]: organization,
  [`GET ${base}/class-types`]: { items: [reformer] },
  [`GET ${base}/rooms`]: { items: [room] },
  [`GET ${base}/members`]: (request: Request) =>
    json({ items: new URL(request.url).searchParams.get("role") === "staff" ? [dana] : [], nextBefore: null }),
};

function renderAt(url: string, routesForApi: Record<string, unknown>, role: "owner" | "staff" = "owner") {
  const me = { ...sampleMe, memberships: [{ ...studio, role, roles: [], permissions: [] }] };
  const api = apiStub({ "POST /api/v1/session": me, ...scheduleRoutes, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

/** The index of the last `method` request whose path ends with `suffix`, for `api.requests` and `api.bodies`. */
function lastIndex(api: ReturnType<typeof apiStub>, method: string, suffix: string): number {
  const matches = api.requests.map((request, index) =>
    request.method === method && new URL(request.url).pathname.endsWith(suffix) ? index : -1,
  );
  return Math.max(...matches);
}

beforeEach(() => {
  // Wednesday 14 October 2026, 12:00 in Israel. Only Date is faked, so user-event's timers still run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the weekly timetable", () => {
  it("shows the week's classes on the studio's clock, with how full each one is", async () => {
    const api = renderAt("/o/neshima/schedule", {
      [`GET ${base}/sessions`]: {
        items: [
          session(),
          session({
            id: id(11),
            localDate: "2026-10-15",
            startsAt: "2026-10-15T04:00:00Z",
            endsAt: "2026-10-15T04:50:00Z",
            bookedCount: 8,
            waitlistCount: 2,
          }),
          session({ id: id(12), localDate: "2026-10-16", startsAt: "2026-10-16T06:00:00Z", status: "cancelled" }),
        ],
      },
    });

    const wednesday = await screen.findByRole("region", { name: "יום רביעי 14.10.2026, היום" });
    const tile = within(wednesday).getByRole("link", { name: /פילאטיס מכשירים/ });
    expect(tile).toHaveTextContent("3 פנויים");
    expect(tile).toHaveTextContent("17:30 · דנה אלון");
    expect(tile).toHaveTextContent("5 מתוך 8 רשומים");
    expect(tile).toHaveAttribute("href", `/o/neshima/schedule/sessions/${id(10)}`);
    expect(screen.getByRole("region", { name: "יום חמישי 15.10.2026" })).toHaveTextContent("מלא · 2 בהמתנה");
    expect(screen.getByRole("region", { name: "יום חמישי 15.10.2026" })).toHaveTextContent("07:00");
    expect(screen.getByRole("region", { name: "יום שישי 16.10.2026" })).toHaveTextContent("בוטל");
    expect(screen.getByRole("region", { name: "יום שבת 17.10.2026" })).toHaveTextContent("אין שיעורים");

    const first = api.requests[lastIndex(api, "GET", "/sessions")]!;
    expect(new URL(first.url).search).toBe("?from=2026-10-11&to=2026-10-17");
    await userEvent.click(screen.getByRole("button", { name: "השבוע הבא" }));
    await waitFor(() =>
      expect(new URL(api.requests[lastIndex(api, "GET", "/sessions")]!.url).search).toBe(
        "?from=2026-10-18&to=2026-10-24",
      ),
    );
  });

  it("creates a weekly class from the day, time and room picked", async () => {
    const api = renderAt("/o/neshima/schedule", {
      [`GET ${base}/sessions`]: { items: [] },
      [`POST ${base}/schedule-templates`]: () => json({ template: template(), untouchedSessions: [] }, 201),
    });
    await userEvent.click(await screen.findByRole("button", { name: "שיעור חדש" }));
    const dialog = screen.getByRole("dialog", { name: "שיעור חדש" });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "דנה אלון" })).toBeInTheDocument());
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "מדריך.ה" }), dana.id);
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "חדר" }), room.id);
    await userEvent.type(within(dialog).getByRole("combobox", { name: /שעת התחלה/ }), "1830");
    expect(within(dialog).getByRole("textbox", { name: /מקומות/ })).toHaveValue("8");
    expect(within(dialog).getByRole("textbox", { name: /משך בדקות/ })).toHaveValue("50");
    expect(dialog).toHaveTextContent("כל יום רביעי, החל מהתאריך הזה");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת השיעור" }));

    expect(await screen.findByText("השיעור נוצר ונפתח להרשמה")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", "/schedule-templates")]).toEqual({
      classTypeId: reformer.id,
      localStart: "18:30",
      minutes: 50,
      capacity: 8,
      instructorMembershipId: dana.id,
      roomId: room.id,
      weekday: 3,
      validFrom: "2026-10-14",
    });
  });

  it("creates a one-off class, and shows why the API refused one", async () => {
    let calls = 0;
    const api = renderAt("/o/neshima/schedule", {
      [`GET ${base}/sessions`]: { items: [] },
      [`POST ${base}/sessions`]: () => (++calls === 1 ? problem(409, "localDate.invalid") : json(session(), 201)),
    });
    await userEvent.click(await screen.findByRole("button", { name: "שיעור חדש" }));
    const dialog = screen.getByRole("dialog", { name: "שיעור חדש" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "שיעור קבוע בכל שבוע" }));
    await userEvent.type(within(dialog).getByRole("combobox", { name: /שעת התחלה/ }), "0900");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת השיעור" }));
    // Capacity is required without a room.
    expect(dialog).toHaveTextContent("בין 1 ל־500");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /מקומות/ }), "12");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת השיעור" }));
    expect(await within(dialog).findByText("אפשר להוסיף רק שיעור שעוד לא התחיל.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת השיעור" }));

    expect(await screen.findByText("השיעור נוצר ונפתח להרשמה")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", "/sessions")]).toEqual({
      classTypeId: reformer.id,
      localStart: "09:00",
      minutes: 50,
      capacity: 12,
      localDate: "2026-10-14",
    });
  });

  it("lets staff see the timetable without the managers' actions", async () => {
    renderAt("/o/neshima/schedule", { [`GET ${base}/sessions`]: { items: [session()] } }, "staff");
    expect(await screen.findByRole("link", { name: /פילאטיס מכשירים/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שיעור חדש" })).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "ניהול הסטודיו" });
    expect(within(nav).getByRole("link", { name: "מערכת שבועית" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "שיעורים קבועים" })).not.toBeInTheDocument();
  });
});

describe("one class", () => {
  it("changes the capacity with If-Match", async () => {
    let current = session();
    const api = renderAt(`/o/neshima/schedule/sessions/${id(10)}`, {
      [`GET ${base}/sessions/${id(10)}`]: () => json(current),
      [`PATCH ${base}/sessions/${id(10)}`]: () => json((current = session({ capacity: 10, version: "5" }))),
    });
    expect(await screen.findByRole("heading", { name: "פילאטיס מכשירים", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("17:30 עד 18:20 · חדר המכשירים")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "עריכה" }));
    const dialog = screen.getByRole("dialog", { name: "עריכת השיעור" });
    const capacity = within(dialog).getByRole("textbox", { name: /מקומות/ });
    await userEvent.clear(capacity);
    await userEvent.type(capacity, "4");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(dialog).toHaveTextContent("כבר רשומים 5");
    await userEvent.clear(capacity);
    await userEvent.type(capacity, "10");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("השיעור נשמר")).toBeInTheDocument();
    const patch = lastIndex(api, "PATCH", `/sessions/${id(10)}`);
    expect(api.requests[patch]!.headers.get("If-Match")).toBe("4");
    expect(api.bodies[patch]).toEqual({ capacity: 10 });
    expect(await screen.findByText("5 מתוך 10 רשומים")).toBeInTheDocument();
  });

  it("cancels the class after saying who will be told", async () => {
    let current = session();
    const api = renderAt(`/o/neshima/schedule/sessions/${id(10)}`, {
      [`GET ${base}/sessions/${id(10)}`]: () => json(current),
      [`POST ${base}/sessions/${id(10)}/cancel`]: () =>
        json((current = session({ status: "cancelled", bookedCount: 0, version: "5" }))),
    });
    await userEvent.click(await screen.findByRole("button", { name: "ביטול השיעור" }));
    const dialog = screen.getByRole("dialog", { name: "לבטל את השיעור?" });
    expect(dialog).toHaveTextContent("5 הרשומים ו־0 הממתינים יקבלו הודעה");
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול השיעור" }));
    expect(await screen.findByText("השיעור בוטל והמתאמנים קיבלו הודעה")).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "POST" && request.url.endsWith("/cancel"))).toBe(true);
    expect(screen.queryByRole("button", { name: "ביטול השיעור" })).not.toBeInTheDocument();
  });
});

describe("weekly classes", () => {
  it("sends only what changed and lists the booked sessions it left alone", async () => {
    const api = renderAt("/o/neshima/weekly-classes", {
      [`GET ${base}/schedule-templates`]: { items: [template()] },
      [`PATCH ${base}/schedule-templates/${id(20)}`]: () =>
        json({ template: template({ localStart: "18:00", version: "3" }), untouchedSessions: [session()] }),
    });
    const row = await screen.findByRole("row", { name: /פילאטיס מכשירים/ });
    expect(row).toHaveTextContent("רביעי 17:30–18:20");
    expect(row).toHaveTextContent("דנה אלון");
    await userEvent.click(within(row).getByRole("button", { name: "עריכת פילאטיס מכשירים ביום רביעי 17:30" }));
    const dialog = screen.getByRole("dialog", { name: "עריכת פילאטיס מכשירים" });
    const start = within(dialog).getByRole("combobox", { name: /שעת התחלה/ });
    await userEvent.clear(start);
    await userEvent.type(start, "1800");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("השיעור הקבוע עודכן")).toBeInTheDocument();
    const patch = lastIndex(api, "PATCH", `/schedule-templates/${id(20)}`);
    expect(api.requests[patch]!.headers.get("If-Match")).toBe("2");
    expect(api.bodies[patch]).toEqual({ localStart: "18:00" });
    expect(screen.getByText(/בשיעור אחד יש כבר הרשמות/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "פילאטיס מכשירים, 14.10.2026 17:30" })).toHaveAttribute(
      "href",
      `/o/neshima/schedule/sessions/${id(10)}`,
    );
  });

  it("ends a weekly class on the day picked", async () => {
    const api = renderAt("/o/neshima/weekly-classes", {
      [`GET ${base}/schedule-templates`]: { items: [template()] },
      [`PATCH ${base}/schedule-templates/${id(20)}`]: () =>
        json({ template: template({ validUntil: "2026-10-14", version: "3" }), untouchedSessions: [] }),
    });
    const row = await screen.findByRole("row", { name: /פילאטיס מכשירים/ });
    await userEvent.click(within(row).getByRole("button", { name: /^סיום/ }));
    const dialog = screen.getByRole("dialog", { name: "לסיים את פילאטיס מכשירים ביום רביעי?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "סיום השיעור הקבוע" }));
    expect(await screen.findByText("השיעור הקבוע יסתיים כמתוכנן")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "PATCH", `/schedule-templates/${id(20)}`)]).toEqual({ validUntil: "2026-10-14" });
  });
});

describe("class types and rooms", () => {
  it("adds a class type", async () => {
    const api = renderAt("/o/neshima/class-types", {
      [`GET ${base}/class-types`]: { items: [] },
      [`POST ${base}/class-types`]: () => json({ ...reformer, id: id(5), name: "יין יוגה" }, 201),
    });
    expect(await screen.findByText("עוד אין סוגי שיעורים.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "סוג שיעור חדש" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "סוג שיעור חדש" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם/ }), "יין יוגה");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /קטגוריה/ }), "yoga");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /צבע בלוח/ }), "blue");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("סוג השיעור נוסף")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", "/class-types")]).toEqual({
      name: "יין יוגה",
      category: "yoga",
      color: "blue",
      defaultMinutes: 50,
    });
  });

  it("adds a room and archives one", async () => {
    const api = renderAt("/o/neshima/rooms", {
      [`POST ${base}/rooms`]: () => json({ ...room, id: id(6), name: "האולם הגדול", defaultCapacity: 14 }, 201),
      [`PATCH ${base}/rooms/${room.id}`]: () => json({ ...room, status: "archived", version: "2" }),
    });
    const row = await screen.findByRole("row", { name: /חדר המכשירים/ });
    await userEvent.click(within(row).getByRole("button", { name: "העברת חדר המכשירים לארכיון" }));
    expect(await screen.findByText("החדר עבר לארכיון")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "PATCH", `/rooms/${room.id}`)]).toEqual({ status: "archived" });

    await userEvent.click(screen.getByRole("button", { name: "חדר חדש" }));
    const dialog = screen.getByRole("dialog", { name: "חדר חדש" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם/ }), "האולם הגדול");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /מקומות/ }), "14");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("החדר נוסף")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", "/rooms")]).toEqual({ name: "האולם הגדול", defaultCapacity: 14 });
  });
});
