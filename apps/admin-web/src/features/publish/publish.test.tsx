import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { candidates, storyLabel, toSlot, whatsappText } from "./storyData";

// MO3 (docs/37 section 7, board #404): the console's "פרסום", four stories drawn on the device, each with its own
// link for Instagram's link sticker, and the same story as WhatsApp text.
const studio = sampleMe.memberships[0]!;
const me = studio.membershipId;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000d${String(n).padStart(4, "0")}`;
const organization = { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" };

const session = (overrides: Record<string, unknown> = {}) => ({
  id: id(10),
  templateId: null,
  localDate: "2026-10-14",
  // Wednesday 12:00 in Israel; the clock below says 11:50.
  startsAt: "2026-10-14T09:00:00Z",
  endsAt: "2026-10-14T09:50:00Z",
  classType: { id: id(1), name: "רפורמר בוקר", category: "pilates", color: "rose" },
  instructor: { membershipId: id(3), displayName: "נועה לוי" },
  room: { id: id(2), name: "חדר המכשירים", spotSelection: false },
  capacity: 4,
  bookedCount: 3,
  waitlistCount: 0,
  status: "scheduled",
  myBooking: null,
  passPreview: null,
  memberNote: null,
  version: "1",
  ...overrides,
});

const sessions = [
  session(),
  session({
    id: id(11),
    localDate: "2026-10-15",
    startsAt: "2026-10-15T15:00:00Z",
    classType: { id: id(4), name: "יוגה זורמת", category: "yoga", color: "sage" },
    instructor: { membershipId: me, displayName: "דנה כהן" },
    capacity: 10,
    bookedCount: 2,
  }),
  session({
    id: id(12),
    localDate: "2026-10-16",
    startsAt: "2026-10-16T06:00:00Z",
    classType: { id: id(5), name: "מזרן", category: "pilates", color: "sand" },
    status: "cancelled",
  }),
];

const instructors = {
  items: [
    { membershipId: id(3), displayName: "נועה לוי", publicProfile: true },
    { membershipId: me, displayName: "דנה כהן", publicProfile: false },
  ],
};

const link = (body: { channel: string; template: string; sessionId: string | null }) => ({
  id: id(90),
  code: "a1b2c3",
  channel: body.channel,
  template: body.template,
  sessionId: body.sessionId,
  url: `https://neshima.test/s/a1b2c3`,
  createdAt: "2026-10-14T08:50:00Z",
});

function renderPublish(
  permissions: readonly string[],
  role: "owner" | "staff" = "owner",
  {
    classes = sessions,
    studioName,
    url = "/o/neshima/publish",
  }: { classes?: unknown[]; studioName?: string; url?: string } = {},
) {
  const member = membershipAs(role, { permissions });
  const api = apiStub({
    "POST /api/v1/session": {
      ...sampleMe,
      memberships: [
        studioName ? { ...member, organization: { ...member.organization, displayName: studioName } } : member,
      ],
    },
    [`GET ${base}`]: organization,
    [`GET ${base}/sessions`]: { items: classes },
    [`GET ${base}/instructors`]: instructors,
    [`GET ${base}/brand`]: { accentId: "ocean" },
    [`POST ${base}/marketing/links`]: async (request: Request) => json(link(await request.json()), 201),
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

const owner = [...membershipAs("owner").permissions, "marketing.publish", "marketing.publish.own"];
const instructor = [...membershipAs("staff").permissions, "marketing.publish.own"];
const linkBodies = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) => (request.url.endsWith("/marketing/links") ? [api.bodies[index]] : []));

let clipboard: string[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T08:50:00Z"));
  clipboard = [];
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText: async (text: string) => void clipboard.push(text) },
  });
  // jsdom draws nothing: no context, and an empty PNG.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob([""])));
  URL.createObjectURL = vi.fn(() => "blob:story");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the console's publishing (MO3)", () => {
  it("offers the week's classes with their labels and downloads the story with its own link on a computer", async () => {
    const api = renderPublish(owner);
    expect(await screen.findByRole("heading", { level: 1, name: "פרסום" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /פרסום/ })).toBeInTheDocument();

    const classes = await screen.findByRole("group", { name: /השיעורים בסטורי/ });
    expect(within(classes).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(classes).getByRole("checkbox", { name: "יום רביעי 12:00 · רפורמר בוקר" })).toBeChecked();
    expect(within(classes).getByText("מקומות אחרונים")).toBeInTheDocument();
    expect(within(classes).getByText("בוטל")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /סטורי: השבוע בסטודיו\. יום רביעי 12:00/ })).toBeInTheDocument();

    await userEvent.click(within(classes).getByRole("checkbox", { name: "יום שישי 09:00 · מזרן" }));
    expect(screen.getByRole("img", { name: /סטורי/ })).not.toHaveAccessibleName(/מזרן/);

    await userEvent.click(screen.getByRole("button", { name: "הורדה והעתקת הלינק" }));
    await waitFor(() => expect(clipboard).toEqual(["https://neshima.test/s/a1b2c3"]));
    expect(linkBodies(api)).toEqual([{ channel: "story", template: "week", sessionId: null }]);
    expect(await screen.findByText("הלינק הועתק, הדביקי אותו במדבקת הלינק")).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("writes the WhatsApp text with a link of its own", async () => {
    const api = renderPublish(owner);
    await userEvent.click(await screen.findByRole("button", { name: /התפנה מקום/ }));
    const select = await screen.findByRole("combobox", { name: "השיעור" });
    expect(select).toHaveValue(id(10));

    await userEvent.click(screen.getByRole("button", { name: "טקסט לוואטסאפ" }));
    const text = await screen.findByRole("textbox", { name: "הטקסט לוואטסאפ" });
    expect(text).toHaveValue(
      "התפנה מקום ברפורמר בוקר עם נועה לוי, היום ב-12:00.\nמי שנרשמת ראשונה מקבלת: https://neshima.test/s/a1b2c3",
    );
    expect(linkBodies(api)).toEqual([{ channel: "whatsapp", template: "spot_opened", sessionId: id(10) }]);
    expect(clipboard).toEqual([(text as HTMLTextAreaElement).value]);
  });

  it("opens the story a suggestion card means, with its class (MO4)", async () => {
    renderPublish(owner, "owner", { url: `/o/neshima/publish?template=spot_opened&session=${id(11)}` });
    expect(await screen.findByRole("combobox", { name: "השיעור" })).toHaveValue(id(11));
    expect(screen.getByRole("button", { name: /התפנה מקום/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the first class when the one in the link is no longer offered", async () => {
    renderPublish(owner, "owner", { url: `/o/neshima/publish?template=spot_opened&session=${id(99)}` });
    expect(await screen.findByRole("combobox", { name: "השיעור" })).toHaveValue(id(10));
  });

  it("shows an instructor only their own classes, and links the story to one of them (M-4)", async () => {
    const api = renderPublish(instructor, "staff");
    const classes = await screen.findByRole("group", { name: /השיעורים בסטורי/ });
    expect(within(classes).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(classes).getByRole("checkbox", { name: "יום חמישי 18:00 · יוגה זורמת" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "הורדה והעתקת הלינק" }));
    await waitFor(() => expect(linkBodies(api)).toEqual([{ channel: "story", template: "week", sessionId: id(11) }]));
  });

  it("shows a studio's and a class's name as literal text, never as markup", async () => {
    const hostile = '<script>alert(1)</script> "מרווח"';
    const studioName = `סטודיו ${hostile}`;
    const classes = [session({ classType: { id: id(1), name: hostile, category: "pilates", color: "rose" } })];
    renderPublish(owner, "owner", { classes, studioName });
    const group = await screen.findByRole("group", { name: /השיעורים בסטורי/ });
    expect(within(group).getByRole("checkbox", { name: `יום רביעי 12:00 · ${hostile}` })).toBeInTheDocument();
    expect(document.body.textContent).toContain(hostile);
    expect(document.body.textContent).toContain(studioName);
    expect(document.body.querySelector("script")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "טקסט לוואטסאפ" }));
    const text = (await screen.findByRole("textbox", { name: "הטקסט לוואטסאפ" })) as HTMLTextAreaElement;
    expect(text.value).toContain(hostile);
    expect(document.body.querySelector("script")).toBeNull();
  });

  it("is not in the menu without a publishing permission", async () => {
    renderPublish(membershipAs("staff").permissions, "staff");
    expect(await screen.findByRole("heading", { name: "אין לך גישה לפרסום" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /פרסום/ })).not.toBeInTheDocument();
  });
});

describe("what a story says", () => {
  const zone = "Asia/Jerusalem";
  const slot = (overrides: Record<string, unknown> = {}, showLeft = false) =>
    toSlot(session(overrides) as never, zone, { showLeft, publicInstructors: new Set([id(3)]) });

  it("labels a class by how booked it is (M-11)", () => {
    expect(storyLabel({ bookedCount: 2, capacity: 4, status: "scheduled" }, false)).toBeNull();
    expect(storyLabel({ bookedCount: 2, capacity: 4, status: "scheduled" }, true)?.text).toBe("נשארו 2 מקומות");
    expect(storyLabel({ bookedCount: 3, capacity: 4, status: "scheduled" }, true)?.text).toBe("מקומות אחרונים");
    expect(storyLabel({ bookedCount: 4, capacity: 4, status: "scheduled" }, false)?.text).toBe("מלא · רשימת המתנה");
    expect(storyLabel({ bookedCount: 0, capacity: 4, status: "cancelled" }, false)?.text).toBe("בוטל");
  });

  it("names only an instructor who agreed to appear publicly (M-14)", () => {
    expect(slot().instructor).toBe("נועה לוי");
    expect(slot({ instructor: { membershipId: me, displayName: "דנה כהן" } }).instructor).toBeNull();
  });

  it("starts the last-places story with today's busy classes that have not begun", () => {
    const now = { today: "2026-10-14" as const, time: "11:50" };
    const early = slot({ id: id(20), startsAt: "2026-10-14T05:00:00Z" });
    const busy = slot();
    const quiet = slot({ id: id(21), startsAt: "2026-10-14T15:00:00Z", bookedCount: 1 });
    const { offered, shown } = candidates("today", [early, busy, quiet], now);
    expect(offered.map((item) => item.id)).toEqual([id(10), id(21)]);
    expect(shown).toEqual([id(10)]);
  });

  it("writes the week as lines with the link last", () => {
    expect(whatsappText("week", "נשימה", [slot()], "https://x.test/s/1", "2026-10-14")).toBe(
      "המערכת של השבוע בנשימה\nרביעי 12:00 · רפורמר בוקר · נועה לוי · מקומות אחרונים\n\nלהרשמה: https://x.test/s/1",
    );
  });
});
