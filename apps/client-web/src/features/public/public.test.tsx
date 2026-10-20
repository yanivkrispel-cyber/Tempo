import type { AuthClient } from "@tempo/api-client/auth";
import type { Schemas } from "@tempo/api-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../../account/account";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { memoryStorage, signedInAuth, signedOutAuth } from "../../test/auth";
import { createStudio, organizationId, sessionIds, testNow } from "../../test/studio";
import { dateLine, roomChip, shortWhen } from "./publicText";
import { captureSource, currentSource, SOURCE_KEY } from "./source";

const api = "/api/v1/public/studios/neshima";

const publicStudio: Schemas["PublicStudio"] = {
  slug: "neshima",
  name: "סטודיו נשימה",
  appName: "נשימה",
  accentId: "ocean",
  logoUrl: null,
  coverUrl: null,
  timeZone: "Asia/Jerusalem",
  introOffer: { name: "שיעור ניסיון", priceAgorot: 4500 },
  openJoin: true,
};

function publicSession(
  id: string,
  startsAt: string,
  name: string,
  overrides: Partial<Schemas["PublicSession"]> = {},
): Schemas["PublicSession"] {
  return {
    id,
    startsAt,
    minutes: 60,
    classType: { name, category: "yoga", color: "mauve" },
    roomName: "החדר הקטן",
    coverUrl: null,
    instructor: { displayName: "נועה", photoUrl: null, headline: "מורה ליוגה", instagramHandle: "noa.yoga" },
    availability: "open",
    spotsLeft: null,
    waitlistOpen: false,
    event: null,
    ...overrides,
  };
}

// testNow is Tuesday 13.10 at 12:00 in Tel Aviv.
const prenatal = publicSession(sessionIds.prenatal, "2026-10-13T16:00:00Z", "יוגה בהריון", {
  availability: "few",
  spotsLeft: 2,
});
const yin = publicSession(sessionIds.yin, "2026-10-13T17:15:00Z", "יין יוגה ונשימה", {
  availability: "full",
  waitlistOpen: true,
});
const over = publicSession(sessionIds.morning, "2026-10-13T05:00:00Z", "פילאטיס מכשירים");
const cancelled = publicSession("0199e5a1-0000-7000-8000-000000000391", "2026-10-15T15:00:00Z", "יוגה בהריון", {
  availability: "cancelled",
});
const vinyasa = publicSession(sessionIds.vinyasa, "2026-10-14T04:00:00Z", "ויניאסה יוגה");
const prenatalLater = publicSession("0199e5a1-0000-7000-8000-000000000392", "2026-10-20T16:00:00Z", "יוגה בהריון");
const all = [over, prenatal, yin, vinyasa, cancelled, prenatalLater];

const notMember: Me = { ...sampleMe, memberships: [] };

function publicRoutes() {
  const routes: Record<string, unknown> = {
    [`GET ${api}`]: publicStudio,
    [`GET ${api}/sessions`]: (request: Request) => {
      const url = new URL(request.url);
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      const day = (session: Schemas["PublicSession"]) =>
        new Date(session.startsAt).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
      return json({ items: all.filter((session) => day(session) >= from && day(session) <= to) });
    },
  };
  for (const session of all) routes[`GET ${api}/sessions/${session.id}`] = session;
  return routes;
}

function renderStudioApp(
  url: string,
  { auth, routes: extra = {} }: { auth?: AuthClient; routes?: Record<string, unknown> } = {},
) {
  const basename = "/s/neshima";
  const router = createMemoryRouter(routes, { initialEntries: [basename + url], basename });
  const stub = apiStub({ ...createStudio().routes, ...publicRoutes(), ...extra });
  render(
    <div dir="rtl">
      <App
        router={router}
        auth={auth ?? signedOutAuth({ basePath: basename })}
        apiUrl="https://api.test"
        fetch={stub.fetch}
        now={testNow}
        studioSlug="neshima"
      />
    </div>,
  );
  return { router, stub };
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-accent");
});

describe("the source of a shared link (docs/37 section 6)", () => {
  const day = 24 * 60 * 60_000;

  it("keeps a valid code for 30 days, and the latest one wins", () => {
    captureSource("?src=story7k2", 1_000);
    expect(currentSource(1_000 + 29 * day)).toBe("story7k2");
    expect(currentSource(1_000 + 30 * day)).toBeNull();
    captureSource("?src=poster01", 2_000);
    expect(currentSource(2_000)).toBe("poster01");
  });

  it.each(["?src=AB12CD", "?src=abc", "?src=<script>", "?src=", ""])("ignores %j", (search) => {
    captureSource("?src=keepme1", 0);
    captureSource(search, 1);
    expect(currentSource(1)).toBe("keepme1");
  });

  it("reads nothing from a broken entry", () => {
    window.localStorage.setItem(SOURCE_KEY, "{not json");
    expect(currentSource()).toBeNull();
  });
});

describe("what a class's public page says (boards א and ז)", () => {
  it("names the day and both ends of the class", () => {
    expect(dateLine(prenatal, "Asia/Jerusalem", "2026-10-13")).toBe("היום 13.10, בין 19:00 ל-20:00");
    expect(dateLine(prenatalLater, "Asia/Jerusalem", "2026-10-13")).toBe("שלישי 20.10, בין 19:00 ל-20:00");
    expect(shortWhen(vinyasa, "Asia/Jerusalem", "2026-10-13")).toBe("מחר 07:00");
  });

  it("says how much room an alternative has", () => {
    expect(roomChip(prenatal)).toEqual({ label: "נשארו 2", tone: "warning" });
    expect(roomChip({ ...prenatal, spotsLeft: 1 }).label).toBe("מקום אחרון");
    expect(roomChip(vinyasa)).toEqual({ label: "יש מקום", tone: "brand" });
  });
});

describe("a studio's public page (/s/<slug>/)", () => {
  it("shows a visitor the studio, its offer and the week by day, without the classes already over", async () => {
    renderStudioApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "סטודיו נשימה" })).toBeInTheDocument();
    expect(screen.getByText("שיעור ניסיון · ₪45")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "היום · 13.10" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "מחר · 14.10" })).toBeInTheDocument();
    expect(screen.queryByText("פילאטיס מכשירים")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /יוגה בהריון/ })[0]).toHaveAttribute(
      "href",
      `/s/neshima/c/${prenatal.id}`,
    );
    // A row's chip is short, so the class's name keeps the room on a phone.
    expect(screen.getByText("2 מקומות")).toBeInTheDocument();
    expect(screen.getByText("המתנה")).toBeInTheDocument();
    expect(screen.getByText("בוטל")).toBeInTheDocument();
    // Next week is a page of its own.
    expect(screen.getByRole("link", { name: "השבוע הבא" })).toHaveAttribute("href", "/s/neshima/week/2026-10-18");
  });

  it("shows the week from its Sunday, and sends a week already over back to this one", async () => {
    const { router } = renderStudioApp("/week/2026-10-21");
    expect(await screen.findByRole("heading", { name: "השבוע של 18.10" })).toBeInTheDocument();
    expect(await screen.findByText("יוגה בהריון")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "השבוע הקודם" })).toHaveAttribute("href", "/s/neshima");

    void router.navigate("/week/2026-10-04");
    await waitFor(() => expect(router.state.location.pathname).toBe("/s/neshima"));
  });

  it("says so for a studio without a public page", async () => {
    renderStudioApp("/", { routes: { [`GET ${api}`]: problem(404, "studio.not_found") } });
    expect(await screen.findByRole("heading", { name: "הסטודיו לא נמצא" })).toBeInTheDocument();
  });

  it("asks a visitor who taps join to sign in, and comes back with the sheet open", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    renderStudioApp("/", { auth: signedOutAuth({ redirect, flowStorage, basePath: "/s/neshima" }) });
    await userEvent.click(await screen.findByRole("button", { name: "הצטרפות לסטודיו" }));
    const sheet = screen.getByRole("dialog", { name: "הצטרפות לסטודיו נשימה" });
    await userEvent.click(within(sheet).getByRole("button", { name: "התחברות" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({
      returnTo: "/s/neshima/?reserve=1",
    });
  });

  it("shows a signed-in visitor who has not joined the public page, not an empty home", async () => {
    renderStudioApp("/", {
      auth: signedInAuth({ basePath: "/s/neshima" }),
      routes: { "POST /api/v1/session": notMember },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "סטודיו נשימה" })).toBeInTheDocument();
    expect(screen.queryByText("עוד לא הצטרפת לסטודיו")).not.toBeInTheDocument();
  });
});

describe("a class's public page (/s/<slug>/c/<id>, SL-2, SL-3)", () => {
  it("shows the class, its teacher and the offer, and asks a visitor to sign in on the same page", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    renderStudioApp(`/c/${prenatal.id}`, { auth: signedOutAuth({ redirect, flowStorage, basePath: "/s/neshima" }) });
    expect(await screen.findByRole("heading", { level: 1, name: "יוגה בהריון" })).toBeInTheDocument();
    expect(screen.getByText("היום 13.10, בין 19:00 ל-20:00")).toBeInTheDocument();
    expect(screen.getByText("נשארו 2 מקומות")).toBeInTheDocument();
    expect(screen.getByText("נועה")).toBeInTheDocument();
    expect(screen.getByText("מורה ליוגה")).toBeInTheDocument();
    expect(screen.getByText("החדר הקטן")).toBeInTheDocument();
    expect(screen.getByText("שיעור ניסיון · ₪45")).toBeInTheDocument();
    expect(screen.getByText("משלמים בסטודיו, בלי כרטיס אשראי עכשיו")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כל המערכת" })).toHaveAttribute("href", "/s/neshima");
    expect(screen.getByText("Tempo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "@noa.yoga" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/noa.yoga/",
    );

    await userEvent.click(screen.getByRole("button", { name: "שריינו לי מקום" }));
    const sheet = screen.getByRole("dialog", { name: "שריינו לי מקום" });
    expect(within(sheet).getByText(/נרשמים כאן, משלמים בסטודיו/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "הרשמה" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({
      returnTo: `/s/neshima/c/${prenatal.id}?reserve=1`,
    });
  });

  it("joins a signed-in visitor with the link's source, then opens the booking, which carries it too", async () => {
    captureSource("?src=story7k2");
    let joined = false;
    const { router, stub } = renderStudioApp(`/c/${prenatal.id}?reserve=1`, {
      auth: signedInAuth({ basePath: "/s/neshima" }),
      routes: {
        "POST /api/v1/session": () => json(joined ? sampleMe : notMember),
        [`POST ${api}/join`]: () => {
          joined = true;
          return json({
            organizationId,
            membershipId: sampleMe.memberships[0]!.membershipId,
            created: true,
            introPass: null,
          });
        },
      },
    });
    const sheet = await screen.findByRole("dialog", { name: "שריינו לי מקום" });
    await userEvent.click(within(sheet).getByRole("button", { name: "הצטרפות לסטודיו והמשך" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/neshima/classes/${prenatal.id}`));
    const joinCall = stub.requests.findIndex((request) => request.url.endsWith("/join"));
    expect(stub.bodies[joinCall]).toEqual({ src: "story7k2" });
    expect(window.localStorage.getItem("tempo.client-web.studio")).toBe(organizationId);

    const booking = await screen.findByRole("dialog", { name: /הרשמה לשיעור/ });
    await userEvent.click(within(booking).getByRole("button", { name: "אישור ההרשמה" }));
    await waitFor(() =>
      expect(stub.requests.some((request) => request.url.endsWith(`/sessions/${prenatal.id}/bookings`))).toBe(true),
    );
    const bookCall = stub.requests.findIndex((request) => request.url.endsWith(`/sessions/${prenatal.id}/bookings`));
    expect(stub.bodies[bookCall]).toEqual({ src: "story7k2" });
  });

  it("explains a closed studio's refusal in Hebrew", async () => {
    renderStudioApp(`/c/${prenatal.id}?reserve=1`, {
      auth: signedInAuth({ basePath: "/s/neshima" }),
      routes: { "POST /api/v1/session": notMember, [`POST ${api}/join`]: problem(403, "join.closed") },
    });
    const sheet = await screen.findByRole("dialog", { name: "שריינו לי מקום" });
    await userEvent.click(within(sheet).getByRole("button", { name: "הצטרפות לסטודיו והמשך" }));
    expect(await within(sheet).findByText(/מצרף מתאמנים בהזמנה בלבד/)).toBeInTheDocument();
  });

  it("sends a member straight to the class with the booking sheet open", async () => {
    const { router } = renderStudioApp(`/c/${prenatal.id}`, { auth: signedInAuth({ basePath: "/s/neshima" }) });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/neshima/classes/${prenatal.id}`));
    expect(await screen.findByRole("dialog", { name: /הרשמה לשיעור/ })).toBeInTheDocument();
  });

  it("says a full class filled up, offers classes with room, and its waitlist", async () => {
    renderStudioApp(`/c/${yin.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "יין יוגה ונשימה, היום 20:15" })).toBeInTheDocument();
    expect(screen.getByText("השיעור התמלא")).toBeInTheDocument();
    expect(screen.getByText("הקישור עדיין עובד. אלה השיעורים הקרובים עם מקום:")).toBeInTheDocument();
    const instead = await screen.findByRole("region", { name: "שיעורים עם מקום" });
    const first = (await within(instead).findAllByRole("link"))[0]!;
    expect(first).toHaveAttribute("href", `/s/neshima/c/${prenatal.id}`);
    expect(first).toHaveTextContent("19:00");
    expect(first).toHaveTextContent("היום 13.10 · נועה");
    expect(within(first).getByText("נשארו 2")).toBeInTheDocument();
    expect(within(instead).getAllByText("יש מקום")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "שריינו לי מקום" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "רשימת המתנה להיום 20:15" }));
    expect(screen.getByRole("dialog", { name: "רשימת המתנה להיום 20:15" })).toBeInTheDocument();
  });

  it("offers no waitlist when a full class has none", async () => {
    const closed = { ...yin, waitlistOpen: false };
    renderStudioApp(`/c/${yin.id}`, { routes: { [`GET ${api}/sessions/${yin.id}`]: closed } });
    expect(await screen.findByText("השיעור התמלא")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "שיעורים עם מקום" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /רשימת המתנה/ })).not.toBeInTheDocument();
  });

  it.each([
    ["cancelled", cancelled.id, "השיעור בוטל"],
    ["over", over.id, "השיעור כבר התקיים"],
  ])("offers up to three classes with room instead of a class that is %s, the same kind first", async (_, id, chip) => {
    renderStudioApp(`/c/${id}`);
    expect(await screen.findByText(chip)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שריינו לי מקום" })).not.toBeInTheDocument();
    const instead = await screen.findByRole("region", { name: "שיעורים עם מקום" });
    const rows = await within(instead).findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    if (id === cancelled.id) expect(rows[0]).toHaveTextContent("יוגה בהריון");
    expect(instead).not.toHaveTextContent("יין יוגה ונשימה");
  });

  it("says a class is gone and still offers others", async () => {
    renderStudioApp("/c/0199e5a1-0000-7000-8000-000000000399");
    expect(await screen.findByRole("heading", { level: 1, name: "השיעור לא נמצא" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "שיעורים עם מקום" })).toBeInTheDocument();
  });

  it("is not a page in the generic app", async () => {
    const stub = apiStub(publicRoutes());
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: [`/c/${prenatal.id}`] })}
        auth={signedOutAuth()}
        apiUrl="https://api.test"
        fetch={stub.fetch}
        now={testNow}
      />,
    );
    expect(await screen.findByRole("heading", { name: "הדף לא נמצא" })).toBeInTheDocument();
  });
});

describe("text a studio typed is shown as text, never as markup", () => {
  const hostile = '<script>alert(1)</script> "x" & <b>bold</b>';
  const hostileStudio: Schemas["PublicStudio"] = { ...publicStudio, name: hostile, appName: hostile };
  const hostileClass = publicSession(sessionIds.vinyasa, "2026-10-14T04:00:00Z", hostile, {
    event: { title: hostile, description: hostile, priceAgorot: null, passRequired: false },
  });

  const noMarkup = () => {
    expect(document.body.querySelector("script")).toBeNull();
    expect(document.body.querySelector("b")).toBeNull();
  };

  it("on the studio's public page", async () => {
    renderStudioApp("/", {
      routes: {
        [`GET ${api}`]: hostileStudio,
        [`GET ${api}/sessions`]: json({ items: [hostileClass] }),
      },
    });
    expect(await screen.findByRole("heading", { level: 1, name: hostile })).toBeInTheDocument();
    expect(document.body.textContent).toContain(hostile);
    noMarkup();
  });

  it("on a class's public page", async () => {
    renderStudioApp(`/c/${hostileClass.id}`, {
      routes: { [`GET ${api}`]: hostileStudio, [`GET ${api}/sessions/${hostileClass.id}`]: hostileClass },
    });
    expect(await screen.findByRole("heading", { level: 1, name: hostile })).toBeInTheDocument();
    expect(document.body.textContent).toContain(hostile);
    noMarkup();
  });
});
