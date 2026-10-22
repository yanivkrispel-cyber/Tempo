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
  vi.restoreAllMocks();
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
    expect(screen.getByText("שיעור ניסיון · 45 ₪")).toBeInTheDocument();
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
    expect(screen.getByText("שיעור ניסיון · 45 ₪")).toBeInTheDocument();
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

describe("signing up inside the sheet (board ב, branded_login)", () => {
  const password = "Correct-Horse-9";

  /** Cognito's JSON API by `X-Amz-Target`; `SignUp` can answer that the email is taken. */
  function cognitoStub({ taken = false } = {}) {
    const calls: { target: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const target = String(new Headers(init?.headers).get("X-Amz-Target")).split(".").pop()!;
        calls.push({ target, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        const headers = { "Content-Type": "application/x-amz-json-1.1" };
        if (target === "SignUp" && taken)
          return new Response(JSON.stringify({ __type: "UsernameExistsException" }), { status: 400, headers });
        const body =
          target === "SignUp" || target === "ConfirmSignUp"
            ? { Session: `${target}-session` }
            : { AuthenticationResult: { AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 3600 } };
        return new Response(JSON.stringify(body), { headers });
      }),
    );
    return calls;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("signs a newcomer up with the code, saves the name, joins and opens the booking, all on the class page", async () => {
    vi.stubEnv("VITE_BRANDED_LOGIN", "true");
    const cognito = cognitoStub();
    let joined = false;
    const { router, stub } = renderStudioApp(`/c/${prenatal.id}`, {
      routes: {
        "POST /api/v1/session": () => json(joined ? sampleMe : notMember),
        "PATCH /api/v1/me": () => json(notMember),
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

    await userEvent.click(await screen.findByRole("button", { name: "שריינו לי מקום" }));
    const sheet = screen.getByRole("dialog", { name: "שריינו לי מקום" });
    expect(within(sheet).queryByRole("button", { name: "הרשמה" })).not.toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("שם מלא"), "נגה כהן");
    await userEvent.type(within(sheet).getByLabelText("אימייל"), "noga@example.com");
    await userEvent.type(within(sheet).getByLabelText("סיסמה"), password);
    await userEvent.click(within(sheet).getByRole("button", { name: "שלחו קוד ושריינו" }));

    expect(await within(sheet).findByText(/שלחנו אליו קוד בן שש ספרות/)).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("קוד בן שש ספרות"), "123456");
    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ושריון" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/neshima/classes/${prenatal.id}`));
    expect(cognito.map((call) => call.target)).toEqual(["SignUp", "ConfirmSignUp", "InitiateAuth"]);
    expect(cognito[1]!.body).toMatchObject({ ConfirmationCode: "123456", Session: "SignUp-session" });
    const order = stub.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
    const named = order.indexOf("PATCH /api/v1/me");
    expect(stub.bodies[named]).toEqual({ displayName: "נגה כהן" });
    expect(named).toBeLessThan(order.indexOf(`POST ${api}/join`));
    expect(await screen.findByRole("dialog", { name: /הרשמה לשיעור/ })).toBeInTheDocument();
  });

  it("reads a taken email like a new one, and keeps the usual sign-in one tap away", async () => {
    vi.stubEnv("VITE_BRANDED_LOGIN", "true");
    cognitoStub({ taken: true });
    const { router } = renderStudioApp(`/c/${prenatal.id}?reserve=1`);
    const sheet = await screen.findByRole("dialog", { name: "שריינו לי מקום" });
    await userEvent.type(within(sheet).getByLabelText("שם מלא"), "נגה כהן");
    await userEvent.type(within(sheet).getByLabelText("אימייל"), "noga@example.com");
    await userEvent.type(within(sheet).getByLabelText("סיסמה"), password);
    await userEvent.click(within(sheet).getByRole("button", { name: "שלחו קוד ושריינו" }));
    expect(await within(sheet).findByText(/אם האימייל פנוי, שלחנו אליו קוד/)).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole("button", { name: "שינוי הפרטים" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "כבר מתאמנים כאן? כניסה" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/s/neshima/login"));
    expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe(`/c/${prenatal.id}?reserve=1`);
  });

  it("takes an offer with the sign-up: the join carries the product and the chosen class", async () => {
    vi.stubEnv("VITE_BRANDED_LOGIN", "true");
    cognitoStub();
    const { stub } = renderStudioApp(`/o/${offerId}`, {
      routes: {
        ...offerRoutes,
        "POST /api/v1/session": notMember,
        "PATCH /api/v1/me": notMember,
        [`POST ${api}/join`]: () => json(joinResponse()),
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "לקחת את המבצע ולשריין" }));
    const sheet = await screen.findByRole("dialog", { name: "לקחת את המבצע ולשריין" });
    await userEvent.type(within(sheet).getByLabelText("שם מלא"), "נגה כהן");
    await userEvent.type(within(sheet).getByLabelText("אימייל"), "noga@example.com");
    await userEvent.type(within(sheet).getByLabelText("סיסמה"), password);
    await userEvent.click(within(sheet).getByRole("button", { name: "שלחו קוד ושריינו" }));
    await userEvent.type(await within(sheet).findByLabelText("קוד בן שש ספרות"), "123456");
    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ושריון" }));

    expect(await within(sheet).findByRole("link", { name: "לפרטי השיעור" })).toBeInTheDocument();
    const call = stub.requests.findIndex((request) => request.url.endsWith("/join"));
    expect(stub.bodies[call]).toMatchObject({ productId: offerId, sessionId: prenatal.id });
  });
});

const offerId = "0199e5a1-0000-7000-8000-0000000004a1";
const product = (id: string, overrides: Partial<Schemas["PublicProduct"]> = {}): Schemas["PublicProduct"] => ({
  id,
  name: "כרטיסייה",
  kind: "punch_card",
  priceAgorot: 70000,
  entries: 10,
  pricePerClassAgorot: 7000,
  validDays: 180,
  newcomersOnly: false,
  publicUntil: null,
  blurb: null,
  ...overrides,
});
const trial = product(offerId, {
  name: "3 שיעורי ניסיון",
  priceAgorot: 9900,
  entries: 3,
  pricePerClassAgorot: 3300,
  validDays: 35,
  newcomersOnly: true,
  publicUntil: "2026-10-31",
});
const ten = product("0199e5a1-0000-7000-8000-0000000004a2");
const twenty = product("0199e5a1-0000-7000-8000-0000000004a3", {
  name: "20 שיעורים",
  priceAgorot: 130000,
  entries: 20,
  pricePerClassAgorot: 6500,
  validDays: 365,
});
const monthly = product("0199e5a1-0000-7000-8000-0000000004a4", {
  name: "חופשי חודשי",
  kind: "membership",
  priceAgorot: 49000,
  entries: null,
  pricePerClassAgorot: null,
  validDays: 30,
  blurb: "כל השיעורים, מתחדש כל חודש",
});
const offerRoutes = {
  [`GET ${api}/products`]: { items: [trial, ten, twenty, monthly] },
  [`GET ${api}/products/${offerId}`]: { ended: false, product: trial },
};

const joinResponse = (extra: object = {}) => ({
  organizationId,
  membershipId: sampleMe.memberships[0]!.membershipId,
  created: true,
  introPass: { passId: "0199e5a1-0000-7000-8000-0000000004b1", productName: trial.name, toPayAtStudio: true },
  booking: { bookingId: "0199e5a1-0000-7000-8000-0000000004b2", sessionId: prenatal.id, status: "booked" },
  ...extra,
});

describe("an offer's public page (/s/<slug>/o/<id>, SL-4)", () => {
  it("shows the offer, what it includes and the classes to start with, the first one chosen", async () => {
    renderStudioApp(`/o/${offerId}`, { routes: offerRoutes });
    expect(await screen.findByRole("heading", { level: 1, name: "3 שיעורי ניסיון ב-99 ₪" })).toBeInTheDocument();
    expect(screen.getByText("למצטרפים חדשים, עד 31.10")).toBeInTheDocument();
    expect(screen.getByText("שלושה שיעורים לבחירה מכל המערכת, תוך 5 שבועות מהשיעור הראשון.")).toBeInTheDocument();
    expect(screen.getByText("משלמים 99 ₪ בסטודיו, בשיעור הראשון")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כל המערכת" })).toHaveAttribute("href", "/s/neshima");

    const radios = await screen.findAllByRole("radio");
    // Over, full and cancelled classes are not offered; the soonest with room is chosen.
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked();
    expect(within(radios[0]!.closest("label")!).getByText("יוגה בהריון")).toBeInTheDocument();
    expect(within(radios[0]!.closest("label")!).getByText("נשארו 2")).toBeInTheDocument();
    await userEvent.click(radios[1]!);
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it("asks a visitor to sign in and comes back with the same class chosen and the sheet open", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    renderStudioApp(`/o/${offerId}`, {
      auth: signedOutAuth({ redirect, flowStorage, basePath: "/s/neshima" }),
      routes: offerRoutes,
    });
    await userEvent.click((await screen.findAllByRole("radio"))[1]!);
    await userEvent.click(screen.getByRole("button", { name: "לקחת את המבצע ולשריין" }));
    const sheet = await screen.findByRole("dialog", { name: "לקחת את המבצע ולשריין" });
    await userEvent.click(within(sheet).getByRole("button", { name: "התחברות" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({
      returnTo: `/s/neshima/o/${offerId}?s=${vinyasa.id}&reserve=1`,
    });
  });

  async function takeOffer(response: () => Response, choose = 0) {
    captureSource("?src=story7k2");
    const { router, stub } = renderStudioApp(`/o/${offerId}`, {
      auth: signedInAuth({ basePath: "/s/neshima" }),
      routes: { ...offerRoutes, "POST /api/v1/session": notMember, [`POST ${api}/join`]: response },
    });
    await userEvent.click((await screen.findAllByRole("radio"))[choose]!);
    await userEvent.click(screen.getByRole("button", { name: "לקחת את המבצע ולשריין" }));
    const sheet = await screen.findByRole("dialog", { name: "לקחת את המבצע ולשריין" });
    await userEvent.click(within(sheet).getByRole("button", { name: "לקחת את המבצע ולשריין" }));
    return { sheet, router, stub };
  }

  it("joins, takes the offer and books the chosen class in one call, with the kept source", async () => {
    const booking = { ...joinResponse().booking, sessionId: vinyasa.id };
    const { sheet, stub } = await takeOffer(() => json(joinResponse({ booking })), 1);
    const link = await within(sheet).findByRole("link", { name: "לפרטי השיעור" });
    expect(link).toHaveAttribute("href", `/s/neshima/classes/${vinyasa.id}`);
    expect(within(sheet).getByText(/המבצע שמור והשיעור שוריין/)).toBeInTheDocument();
    const call = stub.requests.findIndex((request) => request.url.endsWith("/join"));
    expect(stub.bodies[call]).toEqual({ src: "story7k2", productId: offerId, sessionId: vinyasa.id });
    expect(window.localStorage.getItem("tempo.client-web.studio")).toBe(organizationId);
  });

  it("makes the account before the join, for someone back from the sign-in (O4)", async () => {
    const { sheet, stub } = await takeOffer(() => json(joinResponse()));
    await within(sheet).findByRole("link", { name: "לפרטי השיעור" });
    const urls = stub.requests.map((request) => request.url);
    const session = urls.findIndex((url) => url.endsWith("/api/v1/session"));
    expect(session).toBeGreaterThanOrEqual(0);
    expect(session).toBeLessThan(urls.findIndex((url) => url.endsWith("/join")));
  });

  it("names the sheet for what was done, and points Instagram's browser to the real one (SL-7)", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.43.81 Android",
    );
    await takeOffer(() => json(joinResponse()));
    const done = await screen.findByRole("dialog", { name: "המבצע שלכם" });
    expect(within(done).getByRole("link", { name: "פתיחה בדפדפן" })).toBeInTheDocument();
  });

  it("says when the class is on the waitlist", async () => {
    const booking = { ...joinResponse().booking, status: "waitlisted" };
    const { sheet } = await takeOffer(() => json(joinResponse({ booking })));
    expect(await within(sheet).findByText(/ברשימת ההמתנה של השיעור/)).toBeInTheDocument();
  });

  it("sends the visitor to the health declaration first, which keeps the offer", async () => {
    const { sheet } = await takeOffer(() => json(joinResponse({ booking: null, next: "health_declaration" })));
    expect(await within(sheet).findByText(/הסטודיו מבקש הצהרת בריאות חתומה/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "למילוי הצהרת הבריאות" })).toHaveAttribute(
      "href",
      "/s/neshima/profile/health",
    );
    expect(within(sheet).getByRole("link", { name: "לשיעור, אחרי החתימה" })).toHaveAttribute(
      "href",
      `/s/neshima/classes/${prenatal.id}?book=1`,
    );
  });

  it.each([
    [404, "product.not_found", /המבצע הזה כבר לא מוצג/],
    [409, "offer.ended", /המבצע הסתיים/],
    [409, "offer.not_newcomer", /מיועד למצטרפים חדשים בלבד/],
    [409, "session.full", /השיעור שבחרתם התמלא/],
    [409, "session.not_bookable", /אי אפשר להירשם לשיעור שבחרתם/],
  ])("explains %s %s in plain Hebrew", async (status, code, text) => {
    const { sheet } = await takeOffer(() => problem(status, code));
    expect(await within(sheet).findByText(text)).toBeInTheDocument();
  });

  it("shows the prices with a line when the offer ended", async () => {
    renderStudioApp(`/o/${offerId}`, {
      routes: { ...offerRoutes, [`GET ${api}/products/${offerId}`]: { ended: true, product: null } },
    });
    expect(await screen.findByText(/המבצע הזה הסתיים/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "מחירים" })).toBeInTheDocument();
    expect(await screen.findByText("חופשי חודשי")).toBeInTheDocument();
  });

  it("treats an offer that is not listed like an ended one", async () => {
    renderStudioApp(`/o/${offerId}`, {
      routes: { ...offerRoutes, [`GET ${api}/products/${offerId}`]: problem(404, "product.not_found") },
    });
    expect(await screen.findByText(/המבצע הזה הסתיים/)).toBeInTheDocument();
  });
});

describe("a studio's prices (/s/<slug>/prices, SL-5)", () => {
  it("shows the offer first as a card, then punch cards and the membership, with the price per class", async () => {
    renderStudioApp("/prices", { routes: offerRoutes });
    const card = (await screen.findByText(/פעם ראשונה ב/)).closest("a")!;
    expect(card).toHaveAttribute("href", `/s/neshima/o/${offerId}`);
    expect(within(card).getByText("עד 31.10")).toBeInTheDocument();
    expect(within(card).getByText("3 שיעורי ניסיון")).toBeInTheDocument();
    expect(within(card).getByText("99 ₪")).toBeInTheDocument();
    expect(within(card).getByText("33 ₪ לשיעור, בתוך 5 שבועות")).toBeInTheDocument();

    const cards = screen.getByRole("region", { name: "כרטיסיות" });
    const rows = within(cards).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("70 ₪ לשיעור, תוך 6 חודשים")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("700 ₪")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("65 ₪ לשיעור, תוך שנה")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("1,300 ₪")).toBeInTheDocument();

    const memberships = screen.getByRole("region", { name: "מנוי" });
    expect(within(memberships).getByText("כל השיעורים, מתחדש כל חודש")).toBeInTheDocument();
    expect(within(memberships).getByText("490 ₪")).toBeInTheDocument();
    expect(screen.getByText("נרשמים כאן, ומשלמים בסטודיו.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ניקוב");
  });

  it("is linked from the studio page header, beside the week", async () => {
    renderStudioApp("/", { routes: offerRoutes });
    const nav = await screen.findByRole("navigation", { name: "עמודי הסטודיו" });
    expect(await within(nav).findByRole("link", { name: "מחירים" })).toHaveAttribute("href", "/s/neshima/prices");
    expect(within(nav).getByRole("link", { name: "מערכת" })).toHaveAttribute("href", "/s/neshima");
  });

  it("leaves 'מחירים' out of the header while the studio lists no products (P-3)", async () => {
    const { stub } = renderStudioApp("/", { routes: { ...offerRoutes, [`GET ${api}/products`]: { items: [] } } });
    const nav = await screen.findByRole("navigation", { name: "עמודי הסטודיו" });
    await waitFor(() => expect(stub.requests.some((request) => request.url.endsWith("/products"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(nav).getByRole("link", { name: "מערכת" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "מחירים" })).not.toBeInTheDocument();
  });
});

describe("an event or a workshop (MO6)", () => {
  const workshop = publicSession(sessionIds.vinyasa, "2026-10-16T07:00:00Z", "ויניאסה יוגה", {
    availability: "few",
    spotsLeft: 4,
    event: {
      title: "סדנת נשימה ביום שישי",
      description: "שעתיים של נשימה ותנועה.",
      priceAgorot: 12000,
      passRequired: false,
    },
  });

  it("has its own layout: the event mark, the price, how it is paid and the places left", async () => {
    renderStudioApp(`/c/${workshop.id}`, { routes: { [`GET ${api}/sessions/${workshop.id}`]: workshop } });
    expect(await screen.findByRole("heading", { level: 1, name: "סדנת נשימה ביום שישי" })).toBeInTheDocument();
    expect(screen.getByText("אירוע")).toBeInTheDocument();
    expect(screen.getByText("נשארו 4 מקומות")).toBeInTheDocument();
    expect(screen.getByText("120 ₪")).toBeInTheDocument();
    expect(screen.getByText("משלמים בסטודיו, בלי כרטיסייה")).toBeInTheDocument();
    // The studio's intro offer is about passes; an event without one does not offer it.
    expect(screen.queryByText(/שיעור ניסיון/)).not.toBeInTheDocument();
  });

  it("says a pass is used when the event takes one, and leaves out a price it does not have", async () => {
    const withPass = { ...workshop, event: { ...workshop.event!, priceAgorot: null, passRequired: true } };
    renderStudioApp(`/c/${workshop.id}`, { routes: { [`GET ${api}/sessions/${workshop.id}`]: withPass } });
    expect(await screen.findByText("ההרשמה בכניסה מהכרטיסייה")).toBeInTheDocument();
    expect(screen.queryByText("120 ₪")).not.toBeInTheDocument();
    expect(screen.getByText("שיעור ניסיון · 45 ₪")).toBeInTheDocument();
  });

  it("is marked in the week's list", async () => {
    renderStudioApp("/", { routes: { [`GET ${api}/sessions`]: json({ items: [workshop] }) } });
    const row = (await screen.findByText("סדנת נשימה ביום שישי")).closest("li")!;
    expect(row).toHaveTextContent("אירוע · 120 ₪");
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

describe("a member's invite (SL-8, board ה)", () => {
  const link = (inviterFirstName: string | null, reward: { productName: string } | null = null) => ({
    [`GET ${api}/links/abc123xy`]: { target: { kind: "session", id: prenatal.id }, inviterFirstName, reward },
  });
  const rewardLine = () => screen.queryByText(/^כשתגיעי לשיעור הראשון/);
  const url = `/c/${prenatal.id}?src=abc123xy`;

  it("names the friend who sent the link, above the class", async () => {
    renderStudioApp(url, { routes: link("נגה") });
    expect(await screen.findByText("מזמינה אותך")).toBeInTheDocument();
    expect(screen.getByText("נגה", { selector: "bdi" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "יוגה בהריון" })).toBeInTheDocument();
    expect(rewardLine()).not.toBeInTheDocument();
  });

  it("says under her name what she gets when the friend comes to her first class (R-1, M-17)", async () => {
    renderStudioApp(url, { routes: link("נגה", { productName: "שיעור מתנה" }) });
    expect(await screen.findByText("מזמינה אותך")).toBeInTheDocument();
    const line = await screen.findByText(/^כשתגיעי לשיעור הראשון/);
    expect(line).toHaveTextContent(/^כשתגיעי לשיעור הראשון, נגה מקבלת שיעור מתנה$/);
    expect(within(line).getByText("שיעור מתנה", { selector: "bdi" })).toBeInTheDocument();
  });

  it("says the reward without naming her while her name is hidden", async () => {
    renderStudioApp(url, { routes: link(null, { productName: "שיעור מתנה" }) });
    const line = await screen.findByText(/^כשתגיעי לשיעור הראשון/);
    expect(line).toHaveTextContent(/^כשתגיעי לשיעור הראשון, מי שהזמינה אותך מקבלת שיעור מתנה$/);
    expect(screen.queryByText("מזמינה אותך")).not.toBeInTheDocument();
  });

  it("renders a hostile product name as text", async () => {
    const hostile = "<img src=y onerror=alert(1)>";
    renderStudioApp(url, { routes: link("נגה", { productName: hostile }) });
    expect(await screen.findByText(hostile, { selector: "bdi" })).toBeInTheDocument();
    expect(document.querySelector("img[src='y']")).toBeNull();
  });

  it("names her on the schedule too", async () => {
    renderStudioApp("/?src=abc123xy", { routes: link("נגה") });
    expect(await screen.findByText("מזמינה אותך")).toBeInTheDocument();
  });

  it("shows nothing when her name is hidden", async () => {
    const { stub } = renderStudioApp(url, { routes: link(null) });
    expect(await screen.findByRole("heading", { level: 1, name: "יוגה בהריון" })).toBeInTheDocument();
    await waitFor(() => expect(stub.requests.some((request) => request.url.endsWith("/links/abc123xy"))).toBe(true));
    expect(screen.queryByText("מזמינה אותך")).not.toBeInTheDocument();
  });

  it("still shows the class when the link is unknown", async () => {
    renderStudioApp(url);
    expect(await screen.findByRole("heading", { level: 1, name: "יוגה בהריון" })).toBeInTheDocument();
    expect(screen.queryByText("מזמינה אותך")).not.toBeInTheDocument();
  });

  it("looks nothing up without a source", async () => {
    const { stub } = renderStudioApp(`/c/${prenatal.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "יוגה בהריון" })).toBeInTheDocument();
    expect(stub.requests.some((request) => request.url.includes("/links/"))).toBe(false);
  });

  it("renders a hostile name as text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    renderStudioApp(url, { routes: link(hostile) });
    expect(await screen.findByText(hostile, { selector: "bdi" })).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
