import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";

// Generic questions only: no real health data, not even in tests.
const studio = sampleMe.memberships[0]!;
const org = `/api/v1/organizations/${studio.organization.id}`;
const personId = "0199e5a1-0000-7000-8000-000000000d01";
const health = `${org}/people/${personId}/health-declaration`;

const personDetail = {
  id: personId,
  displayName: "חבר דוגמה",
  givenName: null,
  familyName: null,
  birthDate: null,
  status: "active",
  source: "staff_created",
  hasLogin: true,
  membershipId: null,
  primaryEmail: null,
  primaryPhone: null,
  mergedIntoId: null,
  createdAt: "2026-10-15T08:00:00Z",
  version: "1",
  contactPoints: [],
  consents: [],
  relationships: [],
};

const statusView = (status: string, overrides: Record<string, unknown> = {}) =>
  status === "missing"
    ? { status }
    : {
        status,
        declarationId: "0199e5a1-0000-7000-8000-000000000951",
        formVersion: 1,
        signerRole: "self",
        // 23:30 in Israel on 1 October: still 1 October for the studio, though UTC says the 1st at 20:30.
        signedAt: "2026-10-01T20:30:00Z",
        expiresAt: "2027-10-01T20:30:00Z",
        medicalApprovalOn: null,
        ...overrides,
      };

const answers = {
  declarationId: "0199e5a1-0000-7000-8000-000000000951",
  status: "needs_medical_approval",
  form: {
    version: 1,
    locale: "he-IL",
    questions: [
      { id: "q1", text: "שאלה ראשונה לדוגמה?" },
      { id: "q2", text: "שאלה שנייה לדוגמה?" },
    ],
  },
  answers: [
    { questionId: "q1", answer: true },
    { questionId: "q2", answer: false },
  ],
  signedName: "חבר דוגמה",
  signerRole: "guardian",
  guardianName: "הורה דוגמה",
  signedAt: "2026-10-01T20:30:00Z",
  expiresAt: "2027-10-01T20:30:00Z",
  medicalApprovalOn: null,
};

function renderAt(
  url: string,
  routesForApi: Record<string, unknown>,
  role: "owner" | "admin" | "staff" = "owner",
  permissions?: string[],
) {
  const me = { ...sampleMe, memberships: [membershipAs(role, permissions ? { permissions } : {})] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${org}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
    [`GET ${org}/people/${personId}`]: personDetail,
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

const reads = (api: ReturnType<typeof apiStub>, suffix: string) =>
  api.requests.filter((request) => request.method === "GET" && request.url.endsWith(suffix)).length;

afterEach(() => vi.useRealTimers());

describe("the person card's health declaration (docs/31 sections 5 and 13)", () => {
  it("shows staff with people.view the status and its dates in the studio's days, and no way to the answers", async () => {
    const api = renderAt(`/o/neshima/people/${personId}`, { [`GET ${health}`]: statusView("signed") }, "staff");
    const section = await screen.findByRole("region", { name: "הצהרת בריאות" });
    expect(await within(section).findByText("הצהרת בריאות חתומה")).toHaveClass("tp-chip--success");
    expect(section).toHaveTextContent("נחתמה01.10.2026");
    expect(section).toHaveTextContent("בתוקף עד01.10.2027");
    expect(within(section).queryByRole("button", { name: "הצגת התשובות" })).not.toBeInTheDocument();
    expect(reads(api, "/health-declaration/answers")).toBe(0);
  });

  it("opens the answers only on the click, read-only, and reads them again on every open (each open is audited)", async () => {
    const api = renderAt(`/o/neshima/people/${personId}`, {
      [`GET ${health}`]: statusView("needs_medical_approval", { signerRole: "guardian" }),
      [`GET ${health}/answers`]: () => json(answers, 200, { "Cache-Control": "no-store" }),
    });
    const section = await screen.findByRole("region", { name: "הצהרת בריאות" });
    expect(await within(section).findByText("ממתינה לאישור רפואי")).toBeInTheDocument();
    expect(section).toHaveTextContent("על ידי הורה או אפוטרופוס");
    expect(reads(api, "/health-declaration/answers")).toBe(0);

    await userEvent.click(within(section).getByRole("button", { name: "הצגת התשובות" }));
    const dialog = await screen.findByRole("dialog", { name: "התשובות של חבר דוגמה" });
    expect(dialog).toHaveAccessibleDescription("כל פתיחה של התשובות נרשמת ביומן הפעולות, בלי התוכן.");
    const list = await within(dialog).findByRole("group", { name: "התשובות" });
    expect(within(list).queryAllByRole("radio")).toHaveLength(0);
    expect(
      within(within(list).getByRole("group", { name: "שאלה ראשונה לדוגמה?" })).getByText("כן"),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("הורה דוגמה (הורה או אפוטרופוס)");
    expect(dialog).toHaveTextContent("בשםחבר דוגמה");

    await userEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    expect(screen.queryByText("הורה דוגמה (הורה או אפוטרופוס)")).not.toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: "הצגת התשובות" }));
    expect(await screen.findByRole("group", { name: "התשובות" })).toBeInTheDocument();
    expect(reads(api, "/health-declaration/answers")).toBe(2);
  });

  it("says nothing was signed for a missing declaration, and offers no answers", async () => {
    renderAt(`/o/neshima/people/${personId}`, { [`GET ${health}`]: statusView("missing") });
    const section = await screen.findByRole("region", { name: "הצהרת בריאות" });
    expect(await within(section).findByText("עוד לא נחתמה הצהרה בסטודיו.")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "הצגת התשובות" })).not.toBeInTheDocument();
  });

  it("records a medical approval: the date is the studio's today by default, a future one is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T09:00:00Z"));
    const api = renderAt(`/o/neshima/people/${personId}`, {
      [`GET ${health}`]: statusView("needs_medical_approval"),
      [`POST ${health}/medical-approval`]: async (request: Request) => {
        const { approvedOn } = (await request.json()) as { approvedOn: string };
        return json(statusView("signed", { medicalApprovalOn: approvedOn }));
      },
    });
    const section = await screen.findByRole("region", { name: "הצהרת בריאות" });
    await userEvent.click(await within(section).findByRole("button", { name: "רישום אישור רפואי" }));
    const dialog = screen.getByRole("dialog", { name: "רישום אישור רפואי" });
    const date = within(dialog).getByRole("textbox", { name: /תאריך האישור/ });
    expect(date).toHaveValue("17.10.2026");

    await userEvent.clear(date);
    await userEvent.type(date, "18.10.2026");
    await userEvent.click(within(dialog).getByRole("button", { name: "רישום" }));
    expect(date).toHaveAccessibleDescription("צריך תאריך בין 01.10.2026 ל-17.10.2026");
    expect(api.requests.some((request) => request.url.endsWith("/medical-approval"))).toBe(false);

    await userEvent.clear(date);
    await userEvent.type(date, "16.10.2026");
    await userEvent.click(within(dialog).getByRole("button", { name: "רישום" }));
    expect(await screen.findByText("האישור הרפואי נרשם")).toBeInTheDocument();
    const post = api.requests.findIndex((request) => request.url.endsWith("/medical-approval"));
    expect(api.bodies[post]).toEqual({ approvedOn: "2026-10-16" });
    expect(await within(section).findByText("הצהרת בריאות חתומה")).toBeInTheDocument();
    expect(section).toHaveTextContent("אישור רפואי16.10.2026");
  });

  it("explains a refused approval", async () => {
    renderAt(`/o/neshima/people/${personId}`, {
      [`GET ${health}`]: statusView("needs_medical_approval"),
      [`POST ${health}/medical-approval`]: problem(409, "health.no_approval_needed"),
    });
    const section = await screen.findByRole("region", { name: "הצהרת בריאות" });
    await userEvent.click(await within(section).findByRole("button", { name: "רישום אישור רפואי" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "רישום" }));
    expect(await screen.findByText("ההצהרה לא ממתינה לאישור רפואי. ייתכן שכבר נרשם אישור.")).toBeInTheDocument();
  });
});

const policy = {
  freeCancelHours: 6,
  waitlistCutoffHours: 2,
  bookingHorizonDays: 14,
  waitlistEnabled: true,
  requireHealthDeclaration: false,
  version: "3",
};
const settingsRoutes = {
  [`GET ${org}/notification-settings`]: problem(404, "http.404"),
  [`GET ${org}/notification-templates`]: { items: [] },
  [`GET ${org}/booking-policy`]: policy,
};

describe("the health gate in the booking policy (docs/31 H-5)", () => {
  it("switches on at once with the whole policy and If-Match, for schedule.manage", async () => {
    const api = renderAt(
      "/o/neshima/settings",
      {
        ...settingsRoutes,
        [`PUT ${org}/booking-policy`]: async (request: Request) =>
          json({ ...policy, ...((await request.json()) as object), version: "4" }),
      },
      "owner",
      permissionsFor.owner,
    );
    const card = await screen.findByRole("region", { name: "הרשמה לשיעורים" });
    const gate = await within(card).findByRole("switch", { name: "הרשמה רק עם הצהרת בריאות חתומה" });
    expect(gate).not.toBeChecked();
    await userEvent.click(gate);

    expect(await screen.findByText("מעכשיו הרשמה לשיעור דורשת הצהרת בריאות חתומה")).toBeInTheDocument();
    const put = api.requests.findIndex(
      (request) => request.method === "PUT" && request.url.endsWith("/booking-policy"),
    );
    expect(api.requests[put]!.headers.get("If-Match")).toBe("3");
    expect(api.bodies[put]).toEqual({
      freeCancelHours: 6,
      waitlistCutoffHours: 2,
      bookingHorizonDays: 14,
      waitlistEnabled: true,
      requireHealthDeclaration: true,
    });
    await waitFor(() => expect(gate).toBeChecked());
  });

  it("reads an absent flag as off, and without schedule.manage the switch is read-only", async () => {
    const { requireHealthDeclaration: _, ...older } = policy;
    renderAt("/o/neshima/settings", { ...settingsRoutes, [`GET ${org}/booking-policy`]: older }, "admin");
    const gate = await screen.findByRole("switch", { name: "הרשמה רק עם הצהרת בריאות חתומה" });
    expect(gate).not.toBeChecked();
    expect(gate).toBeDisabled();
  });
});

describe("the roster's health marks", () => {
  const sessionId = "0199e5a1-0000-7000-8000-0000000c0001";
  const session = {
    id: sessionId,
    templateId: null,
    localDate: "2026-10-14",
    startsAt: "2026-10-14T14:30:00Z",
    endsAt: "2026-10-14T15:20:00Z",
    classType: {
      id: "0199e5a1-0000-7000-8000-0000000c0002",
      name: "פילאטיס מכשירים",
      category: "pilates",
      color: "rose",
    },
    instructor: null,
    room: null,
    capacity: 8,
    bookedCount: 5,
    waitlistCount: 0,
    status: "scheduled",
    myBooking: null,
    passPreview: null,
    version: "1",
  };
  const entry = (n: number, name: string, healthStatus: string | null | undefined) => ({
    bookingId: `0199e5a1-0000-7000-8000-0000000c001${n}`,
    person: { id: `0199e5a1-0000-7000-8000-0000000c002${n}`, displayName: name },
    status: "booked",
    waitlistPosition: null,
    passName: null,
    bookedAt: "2026-10-10T18:04:00Z",
    ...(healthStatus === undefined ? {} : { healthStatus }),
  });

  it("marks missing, expired and waiting-for-approval rows, and leaves signed and unknown rows clean", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const me = {
      ...sampleMe,
      memberships: [{ ...studio, role: "staff", roles: [], permissions: permissionsFor.staff }],
    };
    const api = apiStub({
      "POST /api/v1/session": me,
      [`GET ${org}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
      [`GET ${org}/sessions/${sessionId}`]: session,
      [`GET ${org}/booking-policy`]: policy,
      [`GET ${org}/sessions/${sessionId}/roster`]: {
        session,
        booked: [
          entry(1, "אחת", "missing"),
          entry(2, "שתיים", "expired"),
          entry(3, "שלוש", "needs_medical_approval"),
          entry(4, "ארבע", "signed"),
          entry(5, "חמש", undefined),
        ],
        waitlisted: [],
      },
    });
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: [`/o/neshima/schedule/sessions/${sessionId}`] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={api.fetch}
      />,
    );
    const roster = await screen.findByRole("region", { name: "משתתפים" });
    const row = async (name: string) => (await within(roster).findByText(name)).closest("li")!;
    expect((await row("אחת")).querySelector(".tp-chip--warning")?.textContent).toBe("הצהרת בריאות: חסרה");
    expect((await row("שתיים")).querySelector(".tp-chip--danger")?.textContent).toBe("הצהרת בריאות: פגה");
    expect((await row("שלוש")).querySelector(".tp-chip--info")?.textContent).toBe("הצהרת בריאות: נדרש אישור");
    expect((await row("ארבע")).textContent).not.toContain("הצהרת בריאות");
    expect((await row("חמש")).textContent).not.toContain("הצהרת בריאות");
  });
});
