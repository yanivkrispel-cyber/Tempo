import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceLabel, keyBytes } from "../../account/push";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe, signedInRoutes } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const organizationId = sampleMe.memberships[0]!.organization.id;
const base = `/api/v1/organizations/${organizationId}`;
const keyRoute = "GET /api/v1/push/vapid-public-key";
const publicKey = "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const endpoint = "https://fcm.googleapis.com/fcm/send/device-1";

const preferences = {
  groups: [
    { group: "bookings", channels: { inbox: true, push: true } },
    { group: "reminders", channels: { inbox: true, push: true } },
    { group: "studio", channels: { inbox: true, push: true } },
  ],
  reminders: { classTomorrow: true, classSoon: true, passEnding: true, entriesLow: true },
  quietHours: null,
  studioQuietHours: { startsLocal: "22:00", endsLocal: "08:00" },
  studioReminders: { classTomorrow: true, classSoon: true, passEnding: true, entriesLow: true },
  timeZone: "Asia/Jerusalem",
  version: "1",
};

/** A browser with push: a service worker registration whose push manager hands out one subscription. */
function fakePushBrowser(permission: NotificationPermission = "granted") {
  let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
  const unsubscribe = vi.fn(async () => {
    subscription = null;
    return true;
  });
  const subscribe = vi.fn(async () => {
    subscription = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
      unsubscribe,
    };
    return subscription;
  });
  const registration = { pushManager: { getSubscription: async () => subscription, subscribe } };
  const register = vi.fn(async () => registration);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register, ready: Promise.resolve(registration), getRegistration: async () => registration },
  });
  vi.stubGlobal("PushManager", function PushManager() {});
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  return { register, subscribe, unsubscribe, requestPermission };
}

function renderAt(path: string, routesForApi: Record<string, unknown>) {
  const api = apiStub({
    ...signedInRoutes,
    [`GET ${base}/me/notification-preferences`]: preferences,
    [keyRoute]: { publicKey },
    ...routesForApi,
  });
  const auth = signedInAuth();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={api.fetch} today="2026-10-16" />);
  return { api, auth, router };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("push on this device", () => {
  it("is hidden while push is not set up in the environment", async () => {
    fakePushBrowser();
    renderAt("/profile/notifications", { [keyRoute]: problem(404, "push.unavailable") });
    expect(await screen.findByRole("switch", { name: "ההרשמות שלי: התראה בטלפון" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "התראות במכשיר הזה" })).not.toBeInTheDocument();
  });

  it("says so when the browser cannot take push", async () => {
    renderAt("/profile/notifications", {});
    expect(await screen.findByText("הדפדפן הזה לא תומך בהתראות בטלפון.")).toBeInTheDocument();
  });

  it("asks for permission from the switch, subscribes and registers this device", async () => {
    const browser = fakePushBrowser();
    let devices: unknown[] = [];
    const { api } = renderAt("/profile/notifications", {
      [`GET ${base}/me/push-subscriptions`]: () => json({ items: devices }),
      [`POST ${base}/me/push-subscriptions`]: () => {
        devices = [
          { id: "sub-1", deviceLabel: "Chrome, Android", createdAt: "2026-10-16T09:00:00Z", lastSuccessAt: null },
        ];
        return json(devices[0], 201);
      },
    });
    const toggle = await screen.findByRole("switch", { name: "התראות במכשיר הזה" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(browser.requestPermission).not.toHaveBeenCalled();

    await userEvent.click(toggle);

    expect(await screen.findByText("(המכשיר הזה)")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "התראות במכשיר הזה" })).toBeChecked();
    expect(browser.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(browser.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const post = api.requests.findIndex(
      (request) => request.method === "POST" && request.url.endsWith("/push-subscriptions"),
    );
    expect(api.bodies[post]).toEqual({
      endpoint,
      keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      deviceLabel: expect.any(String),
    });
  });

  it("explains a blocked permission", async () => {
    fakePushBrowser("denied");
    renderAt("/profile/notifications", { [`GET ${base}/me/push-subscriptions`]: { items: [] } });
    const toggle = await screen.findByRole("switch", { name: "התראות במכשיר הזה" });
    await waitFor(() => expect(toggle).toBeEnabled());
    vi.stubGlobal("Notification", { permission: "denied", requestPermission: async () => "denied" });
    await userEvent.click(toggle);
    expect(await screen.findByText(/ההתראות חסומות בדפדפן/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "התראות במכשיר הזה" })).toBeDisabled();
    // Why it is disabled reaches a screen reader with the switch.
    expect(screen.getByRole("switch", { name: "התראות במכשיר הזה" })).toHaveAccessibleDescription(
      /ההתראות חסומות בדפדפן/,
    );
  });

  it("removes this device and unsubscribes the browser when the member signs out", async () => {
    const browser = fakePushBrowser();
    await browser.subscribe();
    localStorage.setItem("tempo.push.subscriptions", JSON.stringify({ [organizationId]: "sub-1" }));
    const { api, auth } = renderAt("/profile", {
      [`DELETE ${base}/me/push-subscriptions/sub-1`]: () => new Response(null, { status: 204 }),
    });
    const signOut = vi.spyOn(auth, "signOut").mockImplementation(() => Promise.resolve());

    await userEvent.click(await screen.findByRole("button", { name: "התנתקות" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(
      api.requests.some((request) => request.method === "DELETE" && request.url.endsWith("/push-subscriptions/sub-1")),
    ).toBe(true);
    expect(browser.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem("tempo.push.subscriptions")).toBeNull();
  });

  it("marks a tapped notification read and drops the parameters", async () => {
    const { api, router } = renderAt(`/inbox?studio=${organizationId}&notification=item-7`, {
      [`POST ${base}/me/notifications/item-7/read`]: () => new Response(null, { status: 204 }),
    });
    await waitFor(() =>
      expect(
        api.requests.some((request) => request.method === "POST" && request.url.endsWith("/notifications/item-7/read")),
      ).toBe(true),
    );
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(router.state.location.pathname).toBe("/inbox");
  });
});

describe("push helpers", () => {
  it("names the device by browser and system", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36")).toBe(
      "Chrome, Android",
    );
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari, iOS");
    expect(
      deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0"),
    ).toBe("Edge, Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(
      "Firefox, Mac",
    );
  });

  it("decodes the base64url key", () => {
    expect(Array.from(keyBytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("the service worker", () => {
  type Notice = { title: string; options: { body: string; data: { url: string } } } | null;
  const source = readFileSync(resolve(__dirname, "../../../public/sw.js"), "utf8");
  const events: string[] = [];
  const worker: Record<string, unknown> = {
    addEventListener: (name: string) => events.push(name),
    location: { origin: "https://app.test" },
  };
  new Function("self", source)(worker);
  const notice = worker.tempoNotice as (payload: unknown) => Notice;

  it("writes a class notice from ids, linking the class and the inbox item", () => {
    const shown = notice({
      kind: "booking.promoted",
      organizationId: "org-1",
      inboxItemId: "item-1",
      data: { sessionId: "session-1", bookingId: "booking-1" },
      session: { classTypeName: "יוגה", startsAt: "2026-10-19T09:00:00Z" },
    });
    expect(shown?.title).toBe("התפנה מקום ונרשמת");
    expect(shown?.options.body).toMatch(/^יוגה, /);
    expect(shown?.options.data.url).toBe("/classes/session-1?studio=org-1&notification=item-1");
  });

  it("opens the inbox for a pass notice, and shows nothing for an unknown kind", () => {
    const shown = notice({
      kind: "reminder.entries_low",
      organizationId: "org-1",
      inboxItemId: "item-2",
      data: { passId: "pass-1" },
    });
    expect(shown?.options.body).toBe("כדי להמשיך להירשם לשיעורים, פנו לסטודיו לכרטיסייה חדשה.");
    expect(shown?.options.data.url).toBe("/inbox?studio=org-1&notification=item-2");
    expect(notice({ kind: "something.new", data: {} })).toBeNull();
    expect(notice(null)).toBeNull();
  });

  it("shows the studio's title and body when the payload carries them, and a pointer for an announcement", () => {
    const worded = notice({
      kind: "reminder.class_soon",
      title: "עוד מעט ויניאסה",
      body: "נתראה בעוד שעה",
      data: { sessionId: "session-1" },
      session: { classTypeName: "ויניאסה", startsAt: "2026-10-19T09:00:00Z" },
    });
    expect(worded?.title).toBe("עוד מעט ויניאסה");
    expect(worded?.options.body).toBe("נתראה בעוד שעה");
    const announcement = notice({ kind: "studio.announcement", organizationId: "org-1", data: {} });
    expect(announcement?.title).toBe("הודעה חדשה מהסטודיו");
    expect(announcement?.options.body).toBe("הפרטים בתיבת ההודעות באפליקציה.");
    expect(announcement?.options.data.url).toBe("/inbox?studio=org-1");
  });

  it("listens for push and notification clicks", () => {
    expect(events).toEqual(expect.arrayContaining(["push", "notificationclick"]));
  });
});
