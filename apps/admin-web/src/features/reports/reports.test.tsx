import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";
import { lastFullWeeks, periodDays, periodProblem } from "./period";

// Fictional studio, names and figures only.
const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000c${String(n).padStart(4, "0")}`;

const figures = (overrides: Record<string, unknown> = {}) => ({
  sessionsHeld: 0,
  capacity: 0,
  placesBooked: 0,
  attended: 0,
  noShow: 0,
  lateCancellations: 0,
  fillRate: null,
  ...overrides,
});

const summary = {
  from: "2026-09-13",
  to: "2026-10-10",
  timeZone: "Asia/Jerusalem",
  totals: {
    ...figures({
      sessionsHeld: 6,
      capacity: 60,
      placesBooked: 45,
      attended: 42,
      noShow: 3,
      lateCancellations: 1,
      fillRate: 0.7,
    }),
    activeMembers: 14,
    newMembers: 3,
  },
  previous: {
    ...figures({ sessionsHeld: 5, capacity: 50, placesBooked: 40, attended: 37, noShow: 2, fillRate: 0.74 }),
    activeMembers: 14,
    newMembers: 5,
    from: "2026-08-16",
    to: "2026-09-12",
  },
  weeks: [
    {
      ...figures({ sessionsHeld: 2, capacity: 20, attended: 15, fillRate: 0.75 }),
      weekStart: "2026-09-13",
      from: "2026-09-13",
      to: "2026-09-19",
    },
    { ...figures(), weekStart: "2026-09-20", from: "2026-09-20", to: "2026-09-26" },
    {
      ...figures({ sessionsHeld: 2, capacity: 20, attended: 12, fillRate: 0.6 }),
      weekStart: "2026-09-27",
      from: "2026-09-27",
      to: "2026-10-03",
    },
    {
      ...figures({ sessionsHeld: 2, capacity: 20, attended: 15, fillRate: 0.75 }),
      weekStart: "2026-10-04",
      from: "2026-10-04",
      to: "2026-10-10",
    },
  ],
  classTypes: [
    {
      ...figures({ sessionsHeld: 4, capacity: 40, placesBooked: 30, attended: 28, noShow: 2, fillRate: 0.7 }),
      classTypeId: id(1),
      name: "פילאטיס מכשירים",
      color: "sage",
    },
    {
      ...figures({
        sessionsHeld: 2,
        capacity: 20,
        placesBooked: 15,
        attended: 14,
        noShow: 1,
        lateCancellations: 1,
        fillRate: 0.7,
      }),
      classTypeId: id(2),
      name: "יוגה בוקר",
      color: "rose",
    },
  ],
};

const passesEnding = {
  today: "2026-10-14",
  truncated: true,
  items: [
    {
      personId: id(10),
      displayName: "נועה לדוגמה",
      passId: id(20),
      productName: "כרטיסיית 10",
      kind: "punch_card",
      endsOn: "2026-12-01",
      entriesLeft: 1,
      reason: "last_entry",
    },
    {
      personId: id(11),
      displayName: "עומר לדוגמה",
      passId: id(21),
      productName: "מנוי חודשי",
      kind: "membership",
      endsOn: "2026-10-20",
      entriesLeft: null,
      reason: "ends_soon",
    },
  ],
};

const membersAtRisk = {
  today: "2026-10-14",
  truncated: false,
  items: [
    { personId: id(12), displayName: "מאיה לדוגמה", lastAttendedOn: null, passEndsOn: "2026-11-30" },
    { personId: id(13), displayName: "גיל לדוגמה", lastAttendedOn: "2026-09-01", passEndsOn: "2026-11-15" },
  ],
};

const channel = (name: string, members: number, bookings: number, attended: number) => ({
  channel: name,
  members,
  bookings,
  attended,
});
const sourceLink = (n: number, overrides: Record<string, unknown> = {}) => ({
  linkId: id(70 + n),
  code: `c0de${n}`,
  channel: "story",
  template: "week",
  sessionId: null,
  createdAt: `2026-10-0${n}T08:00:00Z`,
  members: 1,
  bookings: n,
  attended: 0,
  ...overrides,
});
const sources = {
  days: 7,
  byChannel: [
    channel("story", 3, 9, 6),
    channel("whatsapp", 1, 2, 2),
    channel("bio", 0, 0, 0),
    channel("poster", 0, 0, 0),
    channel("member_card", 0, 0, 0),
    channel("referral", 0, 0, 0),
    channel("other", 0, 0, 0),
  ],
  byLink: [
    sourceLink(1),
    sourceLink(2, { channel: "whatsapp", template: "spot_opened", sessionId: id(10), members: 0, bookings: 2 }),
    ...[3, 4, 5, 6, 7, 8, 9].map((n) => sourceLink(n)),
  ],
};
const emptySources = { days: 7, byChannel: sources.byChannel.map((row) => channel(row.channel, 0, 0, 0)), byLink: [] };

type Permissions = readonly string[];
const owner: Permissions = [...permissionsFor.owner, "reports.view"];

function renderAt(url: string, permissions: Permissions = owner, routesForApi: Record<string, unknown> = {}) {
  const me = { ...sampleMe, memberships: [{ ...studio, permissions: [...permissions] }] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
    [`GET ${base}/reports/summary`]: summary,
    [`GET ${base}/reports/passes-ending`]: passesEnding,
    [`GET ${base}/reports/members-at-risk`]: membersAtRisk,
    [`GET ${base}/reports/sources`]: sources,
    ...routesForApi,
  });
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

const reportRequests = (api: ReturnType<typeof apiStub>, suffix: string) =>
  api.requests
    .filter((request) => new URL(request.url).pathname.endsWith(suffix))
    .map((request) => new URL(request.url));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday 14 October 2026, noon in Israel.
  vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the reports menu item", () => {
  it("is there for a holder of reports.view and leads to the page", async () => {
    renderAt("/o/neshima");
    const nav = await screen.findByRole("navigation", { name: "ניהול הסטודיו" });
    const link = within(nav).getByRole("link", { name: "דוחות" });
    expect(link).toHaveAttribute("href", "/o/neshima/reports");
  });

  it("is missing for staff, and the route itself shows no report and asks for none", async () => {
    const api = renderAt("/o/neshima/reports", permissionsFor.staff);
    expect(await screen.findByRole("heading", { name: "אין לך גישה לדוחות" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "ניהול הסטודיו" });
    expect(within(nav).queryByRole("link", { name: "דוחות" })).toBeNull();
    expect(reportRequests(api, "/reports/summary")).toHaveLength(0);
    expect(reportRequests(api, "/reports/passes-ending")).toHaveLength(0);
  });
});

describe("the summary", () => {
  it("asks for the server's default period first and shows the four tiles with their change in words", async () => {
    const api = renderAt("/o/neshima/reports");
    const tiles = await screen.findByRole("group", { name: "מדדי התקופה" });
    const [visits, fill, active, fresh] = [...tiles.querySelectorAll(".tp-kpi")];
    expect(visits).toHaveTextContent("ביקורים42עלייה של 5 לעומת התקופה הקודמת");
    expect(fill).toHaveTextContent("שיעור תפוסה70%ירידה של 4% לעומת התקופה הקודמת");
    expect(active).toHaveTextContent("ללא שינוי לעומת התקופה הקודמת");
    expect(fresh).toHaveTextContent("ירידה של 2 לעומת התקופה הקודמת");
    expect(screen.getByText(/13\.09\.2026/).closest("p")).toHaveTextContent("מ־13.09.2026 עד 10.10.2026");

    const [request] = reportRequests(api, "/reports/summary");
    expect(request!.searchParams.has("from")).toBe(false);
    expect(request!.searchParams.has("to")).toBe(false);
  });

  it("draws attended visits per week, the empty week included, and lists the class types with a total", async () => {
    renderAt("/o/neshima/reports");
    const chart = await screen.findByRole("figure", { name: "ביקורים לפי שבוע" });
    const weekRows = within(within(chart).getByRole("table")).getAllByRole("row").slice(1);
    expect(weekRows.map((row) => row.textContent)).toEqual([
      "השבוע של 13.915",
      "השבוע של 20.90",
      "השבוע של 27.912",
      "השבוע של 4.1015",
    ]);

    const byType = screen.getByRole("table", { name: "הנתונים לפי סוג שיעור" });
    const yoga = within(byType).getByRole("row", { name: /יוגה בוקר/ });
    expect([...yoga.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "2",
      "15",
      "14",
      "1",
      "1",
      "70%",
    ]);
    expect(within(byType).getByRole("row", { name: /סך הכול/ })).toHaveTextContent("סך הכול645423170%");
  });

  it("says when nothing was held instead of an empty table", async () => {
    renderAt("/o/neshima/reports", owner, {
      [`GET ${base}/reports/summary`]: {
        ...summary,
        totals: { ...figures(), activeMembers: 0, newMembers: 0 },
        weeks: summary.weeks.map((week) => ({ ...week, ...figures() })),
        classTypes: [],
      },
    });
    expect(await screen.findByText("לא התקיימו שיעורים בתקופה הזאת.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "הנתונים לפי סוג שיעור" })).toBeNull();
    const fill = within(screen.getByRole("group", { name: "מדדי התקופה" }))
      .getByText("—")
      .closest(".tp-kpi");
    // Nothing held, so there is no rate to compare: the tile says why, not that there is no previous period.
    expect(fill).toHaveTextContent("לא התקיימו שיעורים בתקופה");
  });

  it("asks for the last 8 full weeks on the studio's calendar", async () => {
    const user = userEvent.setup();
    const api = renderAt("/o/neshima/reports");
    await screen.findByRole("group", { name: "מדדי התקופה" });
    await user.click(screen.getByRole("button", { name: "8 שבועות" }));
    await vi.waitFor(() => expect(reportRequests(api, "/reports/summary")).toHaveLength(2));
    const request = reportRequests(api, "/reports/summary")[1]!;
    expect(request.searchParams.get("from")).toBe("2026-08-16");
    expect(request.searchParams.get("to")).toBe("2026-10-10");
  });

  it("offers three presets that fit a phone, and the custom dates as a toggle of their own", async () => {
    const user = userEvent.setup();
    renderAt("/o/neshima/reports");
    await screen.findByRole("group", { name: "מדדי התקופה" });
    const presets = screen.getByRole("group", { name: "תקופה" });
    expect(
      within(presets)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["4 שבועות", "8 שבועות", "12 שבועות"]);
    expect(within(presets).getByRole("button", { name: "4 שבועות" })).toHaveAttribute("aria-pressed", "true");
    const custom = screen.getByRole("button", { name: "תאריכים אחרים" });
    expect(custom).toHaveAttribute("aria-pressed", "false");
    await user.click(custom);
    expect(custom).toHaveAttribute("aria-pressed", "true");
    for (const button of within(presets).getAllByRole("button"))
      expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("starts custom dates from the period on screen and refuses more than 92 days without asking", async () => {
    const user = userEvent.setup();
    const api = renderAt("/o/neshima/reports");
    await screen.findByRole("group", { name: "מדדי התקופה" });
    await user.click(screen.getByRole("button", { name: "תאריכים אחרים" }));
    const from = screen.getByRole("textbox", { name: /מתאריך/ });
    expect(from).toHaveValue("13.09.2026");
    expect(screen.getByRole("textbox", { name: /עד תאריך/ })).toHaveValue("10.10.2026");

    await user.clear(from);
    await user.type(from, "01.06.2026");
    await user.tab();
    expect(await screen.findByText("דוח מכסה עד 92 ימים. קצרו את התקופה.")).toBeInTheDocument();
    expect(reportRequests(api, "/reports/summary").every((url) => url.searchParams.get("from") !== "2026-06-01")).toBe(
      true,
    );
  });

  it("lets either end be typed first: a start after the old end is kept, and the report follows once the end moves", async () => {
    const user = userEvent.setup();
    const api = renderAt("/o/neshima/reports");
    await screen.findByRole("group", { name: "מדדי התקופה" });
    await user.click(screen.getByRole("button", { name: "תאריכים אחרים" }));
    // The inputs start at 13.09 to 10.10 (the period on screen); move the whole period past 10.10.
    const from = screen.getByRole("textbox", { name: /מתאריך/ });
    await user.clear(from);
    await user.type(from, "11.10.2026");
    await user.tab();
    expect(await screen.findByText("תאריך הסיום לפני תאריך ההתחלה.")).toBeInTheDocument();
    const to = screen.getByRole("textbox", { name: /עד תאריך/ });
    await user.clear(to);
    await user.type(to, "14.10.2026");
    await user.tab();
    await vi.waitFor(() =>
      expect(
        reportRequests(api, "/reports/summary").some(
          (url) => url.searchParams.get("from") === "2026-10-11" && url.searchParams.get("to") === "2026-10-14",
        ),
      ).toBe(true),
    );
  });

  it("shows the server's words when it refuses the period", async () => {
    renderAt("/o/neshima/reports", owner, {
      [`GET ${base}/reports/summary`]: problem(400, "report.period_too_long"),
    });
    // The query retries once before it shows the error.
    expect(await screen.findByText("דוח מכסה עד 92 ימים. קצרו את התקופה.", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("the two lists", () => {
  it("link each person to their card and say why they are listed", async () => {
    renderAt("/o/neshima/reports");
    const ending = await screen.findByRole("list", { name: "כרטיסיות ומנויים שמסתיימים" });
    const [noa, omer] = within(ending).getAllByRole("link");
    expect(noa).toHaveAttribute("href", `/o/neshima/people/${id(10)}`);
    expect(noa).toHaveTextContent("נועה לדוגמהכרטיסיית 10נשארה כניסה אחת");
    expect(omer).toHaveTextContent("מסתיים ב־20.10");
    expect(screen.getByText("מוצגים 50 הראשונים.")).toBeInTheDocument();

    const atRisk = screen.getByRole("list", { name: "לא הגיעו 30 ימים" });
    const [maya, gil] = within(atRisk).getAllByRole("link");
    expect(maya).toHaveTextContent("עוד לא הגיעו לשיעור");
    expect(gil).toHaveTextContent("ביקור אחרון: 01.09.2026");
    expect(gil).toHaveTextContent("בתוקף עד 15.11");
    expect(gil).toHaveAttribute("href", `/o/neshima/people/${id(13)}`);
  });

  it("are neither shown nor asked for without people.view (R-6)", async () => {
    const withoutPeople = owner.filter((permission) => permission !== "people.view");
    const api = renderAt("/o/neshima/reports", withoutPeople);
    await screen.findByRole("group", { name: "מדדי התקופה" });
    expect(screen.queryByRole("heading", { name: "כרטיסיות ומנויים שמסתיימים" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "לא הגיעו 30 ימים" })).toBeNull();
    expect(reportRequests(api, "/reports/passes-ending")).toHaveLength(0);
    expect(reportRequests(api, "/reports/members-at-risk")).toHaveLength(0);
  });

  it("say so when empty", async () => {
    renderAt("/o/neshima/reports", owner, {
      [`GET ${base}/reports/passes-ending`]: { today: "2026-10-14", truncated: false, items: [] },
      [`GET ${base}/reports/members-at-risk`]: { today: "2026-10-14", truncated: false, items: [] },
    });
    expect(await screen.findByText("אין כרטיסיות או מנויים שמסתיימים בקרוב.")).toBeInTheDocument();
    expect(await screen.findByText("כל מי שמחזיק כרטיסייה בתוקף הגיע בחודש האחרון.")).toBeInTheDocument();
  });
});

describe("where sign-ups came from (MO4)", () => {
  it("counts per channel with a total and per link, the busiest first, and switches to 30 days", async () => {
    const api = renderAt("/o/neshima/reports");
    const card = await screen.findByRole("region", { name: "מאיפה הגיעו ההרשמות" });
    const byChannel = await within(card).findByRole("table", { name: "ההרשמות לפי ערוץ" });
    // Channels with nothing are left out.
    expect(
      within(byChannel)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual(["ערוץהצטרפונרשמו לשיעורהגיעו", "סטורי396", "וואטסאפ122", "סך הכול4118"]);

    const byLink = within(card).getByRole("table", { name: "ההרשמות לפי לינק" });
    const rows = within(byLink).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent(/^סטורי · השבוע בסטודיו/);
    expect(within(byLink).getByRole("rowheader", { name: /וואטסאפ · התפנה מקום/ })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "כל 9 הלינקים" }));
    expect(within(byLink).getAllByRole("row")).toHaveLength(10);

    expect(reportRequests(api, "/reports/sources").map((url) => url.searchParams.get("days"))).toEqual(["7"]);
    await userEvent.click(within(card).getByRole("button", { name: "30 ימים" }));
    await waitFor(() =>
      expect(reportRequests(api, "/reports/sources").map((url) => url.searchParams.get("days"))).toEqual(["7", "30"]),
    );
  });

  it("says what to do when no link brought anyone", async () => {
    renderAt("/o/neshima/reports", [...owner, "marketing.publish"], { [`GET ${base}/reports/sources`]: emptySources });
    const card = await screen.findByRole("region", { name: "מאיפה הגיעו ההרשמות" });
    expect(await within(card).findByText(/לא הגיעו הרשמות דרך לינקים/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "לעמוד הפרסום" })).toHaveAttribute("href", "/o/neshima/publish");
  });
});

describe("the period rules", () => {
  it("counts the last full Sunday-to-Saturday weeks before today's week", () => {
    expect(lastFullWeeks("2026-10-14", 4)).toEqual({ from: "2026-09-13", to: "2026-10-10" });
    // A Sunday: the week that starts today isn't full yet.
    expect(lastFullWeeks("2026-10-11", 1)).toEqual({ from: "2026-10-04", to: "2026-10-10" });
  });

  it("counts both ends, across a DST change, and allows exactly 92 days", () => {
    expect(periodDays({ from: "2026-10-20", to: "2026-10-30" })).toBe(11);
    expect(periodDays({ from: "2026-03-20", to: "2026-03-31" })).toBe(12);
    expect(periodProblem("2026-07-01", "2026-09-30")).toBeNull();
    expect(periodProblem("2026-07-01", "2026-10-01")).toBe("דוח מכסה עד 92 ימים. קצרו את התקופה.");
    expect(periodProblem("2026-10-02", "2026-10-01")).toBe("תאריך הסיום לפני תאריך ההתחלה.");
    expect(periodProblem(null, "2026-10-01")).toBe("בחרו תאריך התחלה ותאריך סיום.");
  });
});
