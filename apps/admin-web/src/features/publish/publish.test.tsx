import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { candidates, defaultTarget, offerHeadline, storyLabel, toSlot, untilWords, whatsappText } from "./storyData";

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

const link = (body: { channel: string; template: string; target: { kind: string; id: string | null } }) => ({
  id: id(90),
  code: "a1b2c3",
  channel: body.channel,
  template: body.template,
  sessionId: body.target.kind === "session" ? body.target.id : null,
  target: body.target,
  url: `https://neshima.test/s/a1b2c3`,
  createdAt: "2026-10-14T08:50:00Z",
});

// SO3: the offers the owner listed on the public page (SL-4), and the products behind them.
const passProduct = (productId: string, name: string, priceAgorot: number, status = "active") => ({
  id: productId,
  kind: "punch_card",
  name,
  entries: 3,
  validDays: 30,
  priceAgorot,
  status,
  version: "1",
});
const trialOffer = passProduct(id(40), "3 שיעורי ניסיון", 9900);
const archivedOffer = passProduct(id(41), "מבצע קיץ", 5000, "archived");
const tenCard = passProduct(id(42), "כרטיסיית 10", 65000);
const listed = [
  { productId: id(40), newcomersOnly: true, publicUntil: "2026-10-31", blurb: "לכל מי שמתחילה" },
  { productId: id(41), newcomersOnly: true, publicUntil: null, blurb: null },
  { productId: id(42), newcomersOnly: false, publicUntil: null, blurb: null },
];

function renderPublish(
  permissions: readonly string[],
  role: "owner" | "staff" = "owner",
  url = "/o/neshima/publish",
  extra: Record<string, unknown> = {},
) {
  const api = apiStub({
    "POST /api/v1/session": { ...sampleMe, memberships: [membershipAs(role, { permissions })] },
    [`GET ${base}`]: organization,
    [`GET ${base}/sessions`]: { items: sessions },
    [`GET ${base}/instructors`]: instructors,
    [`GET ${base}/brand`]: { accentId: "ocean" },
    [`GET ${base}/pass-products`]: { items: [trialOffer, archivedOffer, tenCard] },
    [`GET ${base}/public-page`]: { listedProducts: listed },
    [`POST ${base}/marketing/links`]: async (request: Request) => json(link(await request.json()), 201),
    ...extra,
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
const targetOf = (kind: string, targetId: string | null = null) => ({ kind, id: targetId });
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
    expect(linkBodies(api)).toEqual([{ channel: "story", template: "week", target: targetOf("schedule") }]);
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
    expect(linkBodies(api)).toEqual([
      { channel: "whatsapp", template: "spot_opened", target: targetOf("session", id(10)) },
    ]);
    expect(clipboard).toEqual([(text as HTMLTextAreaElement).value]);
  });

  it("opens the story a suggestion card means, with its class (MO4)", async () => {
    renderPublish(owner, "owner", `/o/neshima/publish?template=spot_opened&session=${id(11)}`);
    expect(await screen.findByRole("combobox", { name: "השיעור" })).toHaveValue(id(11));
    expect(screen.getByRole("button", { name: /התפנה מקום/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the first class when the one in the link is no longer offered", async () => {
    renderPublish(owner, "owner", `/o/neshima/publish?template=spot_opened&session=${id(99)}`);
    expect(await screen.findByRole("combobox", { name: "השיעור" })).toHaveValue(id(10));
  });

  it("shows an instructor only their own classes, and links the story to one of them (M-4)", async () => {
    const api = renderPublish(instructor, "staff");
    const classes = await screen.findByRole("group", { name: /השיעורים בסטורי/ });
    expect(within(classes).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(classes).getByRole("checkbox", { name: "יום חמישי 18:00 · יוגה זורמת" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "הורדה והעתקת הלינק" }));
    await waitFor(() =>
      expect(linkBodies(api)).toEqual([{ channel: "story", template: "week", target: targetOf("session", id(11)) }]),
    );
  });

  it("shows a studio's and a class's name as literal text, never as markup", async () => {
    const hostile = '<script>alert(1)</script> "מרווח"';
    const studioName = `סטודיו ${hostile}`;
    const classes = [session({ classType: { id: id(1), name: hostile, category: "pilates", color: "rose" } })];
    const member = membershipAs("owner", { permissions: owner });
    renderPublish(owner, "owner", undefined, {
      "POST /api/v1/session": {
        ...sampleMe,
        // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test code: the `<script>` text is the hostile fixture this test proves is shown as text.
        memberships: [{ ...member, organization: { ...member.organization, displayName: studioName } }],
      },
      [`GET ${base}/sessions`]: { items: classes },
    });
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

  it("makes the A4 poster with a QR to the week, on a poster link of its own (MO7, docs/37 section 8.6)", async () => {
    const api = renderPublish(owner);
    const poster = await screen.findByRole("region", { name: "פוסטר להדפסה" });
    expect(within(poster).getByRole("img", { name: /^פוסטר: סרקי והירשמי לשיעור/ })).toBeInTheDocument();
    await userEvent.click(within(poster).getByRole("button", { name: "הורדת הפוסטר" }));
    await waitFor(() =>
      expect(linkBodies(api)).toEqual([{ channel: "poster", template: "poster", target: targetOf("schedule") }]),
    );
    expect(await screen.findByText("הפוסטר ירד, מוכן להדפסה ב-A4")).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    // The same link again: a second download reuses it.
    await userEvent.click(within(poster).getByRole("button", { name: "הורדת הפוסטר" }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2));
    expect(linkBodies(api)).toHaveLength(1);
  });

  it("leaves the studio's poster to the owners: an instructor has none", async () => {
    renderPublish(instructor, "staff");
    await screen.findByRole("group", { name: /השיעורים בסטורי/ });
    expect(screen.queryByRole("region", { name: "פוסטר להדפסה" })).not.toBeInTheDocument();
  });

  it("is not in the menu without a publishing permission", async () => {
    renderPublish(membershipAs("staff").permissions, "staff");
    expect(await screen.findByRole("heading", { name: "אין לך גישה לפרסום" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /פרסום/ })).not.toBeInTheDocument();
  });
});

describe("where the link leads (SO3, SL-6)", () => {
  const picker = () => screen.findByRole("group", { name: "לאן הקישור יוביל?" });
  const create = () => userEvent.click(screen.getByRole("button", { name: "הורדה והעתקת הלינק" }));

  it("chooses the template default and sends it", async () => {
    const api = renderPublish(owner);
    const week = await picker();
    expect(within(week).getByRole("radio", { name: "למערכת של השבוע" })).toBeChecked();

    // Last places and a freed spot lead to the class; a change in the timetable leads to the studio page.
    await userEvent.click(screen.getByRole("button", { name: /מקומות אחרונים/ }));
    expect(within(await picker()).getByRole("radio", { name: "לשיעור הזה" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /התפנה מקום/ }));
    expect(within(await picker()).getByRole("radio", { name: "לשיעור הזה" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /שינוי במערכת/ }));
    expect(within(await picker()).getByRole("radio", { name: "למערכת של השבוע" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /התפנה מקום/ }));
    await create();
    await waitFor(() =>
      expect(linkBodies(api)).toEqual([
        { channel: "story", template: "spot_opened", target: targetOf("session", id(10)) },
      ]),
    );
  });

  it("changes the body and asks for a new link when the owner picks another place", async () => {
    const api = renderPublish(owner);
    const group = await picker();
    await userEvent.click(within(group).getByRole("radio", { name: "למחירון" }));
    await create();
    await waitFor(() => expect(linkBodies(api)).toHaveLength(1));
    expect(linkBodies(api)[0]).toEqual({ channel: "story", template: "week", target: targetOf("prices") });

    await userEvent.click(within(await picker()).getByRole("radio", { name: "להצעה למצטרפים" }));
    await userEvent.click(screen.getByRole("button", { name: "הורדה והעתקת הלינק" }));
    await waitFor(() => expect(linkBodies(api)).toHaveLength(2));
    expect(linkBodies(api)[1]).toEqual({ channel: "story", template: "week", target: targetOf("offer", id(40)) });
  });

  it("makes the offer story from the listed offer, to the offer by default, never from an archived one", async () => {
    const api = renderPublish(owner);
    await userEvent.click(await screen.findByRole("button", { name: /הצעה למצטרפים/ }));
    expect(
      await screen.findByRole("img", { name: /סטורי: הצעה למצטרפים\. 3 שיעורי ניסיון ב-99 ₪/ }),
    ).toBeInTheDocument();
    expect(within(await picker()).getByRole("radio", { name: "להצעה למצטרפים" })).toBeChecked();
    // One live offer: nothing to choose from (the archived one and the punch card are not offers).
    expect(screen.queryByRole("combobox", { name: "ההצעה" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "טקסט לוואטסאפ" }));
    const text = await screen.findByRole("textbox", { name: "הטקסט לוואטסאפ" });
    expect(text).toHaveValue(
      "3 שיעורי ניסיון ב-99 ₪ בסטודיו נשימה. עד 31 באוקטובר.\nלכל מי שמתחילה\n\nלהצטרפות: https://neshima.test/s/a1b2c3",
    );
    expect(linkBodies(api)).toEqual([{ channel: "whatsapp", template: "offer", target: targetOf("offer", id(40)) }]);
  });

  it("gives an instructor no choice: the link names their class, and the offer story is not theirs", async () => {
    const api = renderPublish(instructor, "staff");
    await screen.findByRole("group", { name: /השיעורים בסטורי/ });
    expect(screen.queryByRole("group", { name: "לאן הקישור יוביל?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הצעה למצטרפים/ })).not.toBeInTheDocument();
    await create();
    await waitFor(() => expect(linkBodies(api)).toHaveLength(1));
    expect(linkBodies(api)[0]).toMatchObject({ target: targetOf("session", id(11)) });
  });
});

describe("with no offer listed", () => {
  it("says so in the offer story and disables the offer place", async () => {
    // A studio that lists a punch card only.
    renderPublish(owner, "owner", "/o/neshima/publish", {
      [`GET ${base}/public-page`]: { listedProducts: [listed[2]] },
    });
    await userEvent.click(await screen.findByRole("button", { name: /הצעה למצטרפים/ }));
    expect(await screen.findByText(/אין הצעה למצטרפים חדשים בעמוד הציבורי/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הורדה והעתקת הלינק" })).toBeDisabled();
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

describe("the words of the offer story", () => {
  it("defaults each template to a place (SL-6)", () => {
    expect(defaultTarget).toEqual({
      week: "schedule",
      change: "schedule",
      today: "session",
      spot_opened: "session",
      offer: "offer",
    });
  });

  it("writes the headline and the last day", () => {
    expect(offerHeadline({ name: "3 שיעורי ניסיון", priceAgorot: 9900 })).toBe("3 שיעורי ניסיון ב-99 ₪");
    expect(offerHeadline({ name: "3 שיעורי ניסיון", priceAgorot: 9950 })).toBe("3 שיעורי ניסיון ב-99.50 ₪");
    expect(offerHeadline({ name: "שיעור ניסיון", priceAgorot: null })).toBe("שיעור ניסיון");
    expect(untilWords("2026-10-31")).toBe("עד 31 באוקטובר");
  });

  it("falls back to the link alone when there is no offer", () => {
    expect(whatsappText("offer", "נשימה", [], "https://x.test/s/1", "2026-10-14", null)).toBe("https://x.test/s/1");
  });
});
