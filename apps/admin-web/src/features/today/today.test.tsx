import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, roleSummary, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000b${String(n).padStart(4, "0")}`;
const organization = { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" };

const session = (overrides: Record<string, unknown> = {}) => ({
  id: id(10),
  templateId: null,
  localDate: "2026-10-14",
  // 17:30 to 18:20 in Israel (UTC+3 until 25 October).
  startsAt: "2026-10-14T14:30:00Z",
  endsAt: "2026-10-14T15:20:00Z",
  classType: { id: id(1), name: "פילאטיס מכשירים", category: "pilates", color: "rose" },
  instructor: { membershipId: id(3), displayName: "דנה אלון" },
  room: { id: id(2), name: "חדר המכשירים" },
  capacity: 8,
  bookedCount: 5,
  waitlistCount: 0,
  status: "scheduled",
  myBooking: null,
  passPreview: null,
  version: "1",
  ...overrides,
});

function renderAt(url: string, sessions: (request: Request) => unknown) {
  const me = {
    ...sampleMe,
    memberships: [
      { ...studio, role: "staff" as const, roles: [roleSummary("staff")], permissions: permissionsFor.staff },
    ],
  };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: organization,
    [`GET ${base}/sessions`]: (request: Request) =>
      new Response(JSON.stringify({ items: sessions(request) }), { headers: { "Content-Type": "application/json" } }),
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { api, router };
}

beforeEach(() => {
  // 12:00 in Israel on Wednesday 14 October.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the day in the studio (D15, the coach's screen)", () => {
  it("opens the studio for anyone who sees the timetable", async () => {
    const { router } = renderAt("/", () => []);
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/neshima/today"));
    expect(await screen.findByRole("heading", { level: 1, name: "צהריים טובים, דנה" })).toBeInTheDocument();
  });

  it("opens the door scan from the installed app's shortcut, and closing it drops the shortcut", async () => {
    const { router } = renderAt("/?open=scan", () => []);
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/neshima/today"));
    expect(await screen.findByRole("dialog", { name: "סריקת כניסה" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "סריקת כניסה" })).not.toBeInTheDocument());
    expect(router.state.location.search).toBe("");
  });

  it("puts the coach's own classes first, each opening its roster", async () => {
    const mine = session({ id: id(11), instructor: { membershipId: studio.membershipId, displayName: "דנה כהן" } });
    const other = session({
      id: id(12),
      startsAt: "2026-10-14T16:00:00Z",
      endsAt: "2026-10-14T16:50:00Z",
      classType: { id: id(4), name: "יוגה", category: "yoga", color: "sage" },
      bookedCount: 8,
    });
    renderAt("/o/neshima/today", () => [other, mine]);

    const own = await screen.findByRole("region", { name: "השיעורים שלי" });
    expect(within(own).getByRole("link", { name: /פילאטיס מכשירים/ })).toHaveAttribute(
      "href",
      `/o/neshima/schedule/sessions/${id(11)}`,
    );
    expect(within(own).getByText(/17:30 עד 18:20/)).toBeInTheDocument();
    expect(within(own).getByText("3 פנויים")).toBeInTheDocument();

    const rest = screen.getByRole("region", { name: "שאר השיעורים היום" });
    expect(within(rest).getByRole("link", { name: /יוגה/ })).toBeInTheDocument();
    expect(within(rest).getByText("מלא")).toBeInTheDocument();
  });

  it("says which classes are on now, over or cancelled", async () => {
    renderAt("/o/neshima/today", () => [
      session({ id: id(21), startsAt: "2026-10-14T06:00:00Z", endsAt: "2026-10-14T06:50:00Z" }),
      session({ id: id(22), startsAt: "2026-10-14T08:45:00Z", endsAt: "2026-10-14T09:35:00Z" }),
      session({ id: id(23), status: "cancelled" }),
    ]);
    const day = await screen.findByRole("region", { name: "השיעורים היום" });
    expect(within(day).getByText("הסתיים")).toBeInTheDocument();
    expect(within(day).getByText("עכשיו")).toBeInTheDocument();
    expect(within(day).getByText("בוטל")).toBeInTheDocument();
    expect(within(day).getByText(/המתאמנים קיבלו הודעה/)).toBeInTheDocument();
  });

  it("sums the day up under the heading, without the cancelled classes", async () => {
    renderAt("/o/neshima/today", () => [
      session({ id: id(31) }),
      session({ id: id(32), startsAt: "2026-10-14T16:00:00Z", endsAt: "2026-10-14T16:50:00Z", bookedCount: 8 }),
      session({ id: id(33), status: "cancelled", bookedCount: 0 }),
    ]);
    expect(await screen.findByText("היום 2 שיעורים ו־13 נרשמים.")).toBeInTheDocument();
  });

  it("keeps the summary's line while the day loads, so the page below does not jump (O5)", async () => {
    const me = {
      ...sampleMe,
      memberships: [
        { ...studio, role: "staff" as const, roles: [roleSummary("staff")], permissions: permissionsFor.staff },
      ],
    };
    const api = apiStub({
      "POST /api/v1/session": me,
      [`GET ${base}`]: organization,
      // The day's classes never answer: the page stays loading.
      [`GET ${base}/sessions`]: () => new Promise<Response>(() => undefined),
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/o/neshima/today"] });
    render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);

    const heading = await screen.findByRole("heading", { level: 1, name: "צהריים טובים, דנה" });
    const line = heading.nextElementSibling;
    expect(line?.tagName).toBe("P");
    expect(line).toHaveAttribute("aria-hidden", "true");
  });

  it("says one class in words", async () => {
    renderAt("/o/neshima/today", () => [session({ id: id(34), bookedCount: 1 })]);
    expect(await screen.findByText("היום שיעור אחד ורישום אחד.")).toBeInTheDocument();
  });

  it("shows how full each class is on a bar, and none on a cancelled one", async () => {
    renderAt("/o/neshima/today", () => [
      session({ id: id(41) }),
      session({
        id: id(42),
        status: "cancelled",
        classType: { id: id(5), name: "ספינינג", category: "cycle", color: "sand" },
      }),
    ]);
    const day = await screen.findByRole("region", { name: "השיעורים היום" });
    const meters = within(day).getAllByRole("meter");
    expect(meters).toHaveLength(1);
    expect(meters[0]).toHaveAccessibleName("תפוסה, 5 מתוך 8");
    expect(meters[0]).toHaveAttribute("aria-valuenow", "5");
    expect(meters[0]).toHaveAttribute("aria-valuemax", "8");
  });

  it("shows tomorrow on request", async () => {
    const { api } = renderAt("/o/neshima/today", () => []);
    expect(await screen.findByText("אין שיעורים היום.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "מחר" }));
    expect(await screen.findByText("אין שיעורים מחר.")).toBeInTheDocument();
    const asked = api.requests
      .filter((request) => new URL(request.url).pathname === `${base}/sessions`)
      .map((request) => new URL(request.url).searchParams.toString());
    expect(asked).toContain("from=2026-10-15&to=2026-10-15");
    expect(screen.getByText(/15\.10\.2026/)).toBeInTheDocument();
  });
});
