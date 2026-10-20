import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { installDismissed, dismissInstall, listenForInstall, resetInstallForTests } from "../../app/install";
import { routes } from "../../app/routes";
import { apiStub } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { createStudio, sessionIds, testNow } from "../../test/studio";

// Board #347, P-3: never on the first visit. The member app offers itself after a booking (a card on the home that
// can be dismissed for 30 days) and always in the profile. Android and desktop take the browser's own prompt; an
// iPhone gets the steps. Nothing shows when the app already runs installed.

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const day = 24 * 60 * 60 * 1000;

function renderAt(url: string, { booked = true } = {}) {
  const studio = createStudio();
  if (!booked) {
    const bookings = Object.keys(studio.routes).find((key) => key.endsWith("/me/bookings"))!;
    studio.routes[bookings] = { items: [] };
  }
  render(
    <div dir="rtl">
      <App
        router={createMemoryRouter(routes, { initialEntries: [url] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={apiStub(studio.routes).fetch}
        now={testNow}
      />
    </div>,
  );
}

/** What Chrome fires when the app may be installed; `prompt` opens its dialog. */
function offerInstall(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function runInstalled() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(display-mode: standalone)",
      addEventListener() {},
      removeEventListener() {},
    })),
  );
}

beforeEach(() => listenForInstall(window));
afterEach(() => {
  resetInstallForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("installing the app from the profile (P-3)", () => {
  it("takes the browser's own prompt, keeps Chrome's banner away, and goes once installed", async () => {
    renderAt("/profile");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /התקנת האפליקציה/ })).not.toBeInTheDocument();

    const event = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    await userEvent.click(await screen.findByRole("button", { name: /התקנת האפליקציה/ }));
    expect(event.prompt).toHaveBeenCalledOnce();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("button", { name: /התקנת האפליקציה/ })).not.toBeInTheDocument();
  });

  it("shows an iPhone the steps: Share, then Add to Home Screen", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(iphone);
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: /התקנת האפליקציה/ }));

    const sheet = await screen.findByRole("dialog", { name: "התקנה באייפון" });
    const steps = within(sheet)
      .getAllByRole("listitem")
      .map((step) => step.textContent);
    expect(steps).toEqual([
      expect.stringContaining("שיתוף"),
      expect.stringContaining("הוספה למסך הבית"),
      expect.stringContaining("הוספה"),
    ]);
    await userEvent.click(within(sheet).getByRole("button", { name: "הבנתי" }));
    expect(screen.queryByRole("dialog", { name: "התקנה באייפון" })).not.toBeInTheDocument();
  });

  it("says nothing when the app already runs installed", async () => {
    runInstalled();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(iphone);
    renderAt("/profile");
    await screen.findByRole("heading", { level: 1 });
    offerInstall();
    expect(screen.queryByRole("button", { name: /התקנת האפליקציה/ })).not.toBeInTheDocument();
  });
});

describe("in Instagram's own browser", () => {
  it("offers no install, which that browser cannot do", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(`${iphone} Instagram 350.0.0.0`);
    renderAt("/profile");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /התקנת האפליקציה/ })).not.toBeInTheDocument();
  });
});

describe("the install offer after booking a class (board ח)", () => {
  it("takes the browser's prompt from the 'place held' dialog", async () => {
    const event = offerInstall();
    renderAt(`/classes/${sessionIds.prenatal}`);
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור" }));
    await userEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
    const done = await screen.findByRole("dialog", { name: /שמרנו לך מקום/ });
    const offer = within(done).getByRole("region", { name: "סטודיו נשימה במסך הבית" });
    await userEvent.click(within(offer).getByRole("button", { name: "הוספה למסך הבית" }));
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it("goes for 30 days on 'later'", async () => {
    offerInstall();
    renderAt(`/classes/${sessionIds.prenatal}`);
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור" }));
    await userEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
    const done = await screen.findByRole("dialog", { name: /שמרנו לך מקום/ });
    await userEvent.click(within(done).getByRole("button", { name: "אחר כך" }));
    expect(within(done).queryByRole("region", { name: "סטודיו נשימה במסך הבית" })).not.toBeInTheDocument();
    expect(installDismissed()).toBe(true);
  });
});

describe("the install card on the home (P-3)", () => {
  it("is not there before the member has booked a class", async () => {
    offerInstall();
    renderAt("/", { booked: false });
    await screen.findByText("אין לך שיעור קרוב");
    expect(screen.queryByRole("region", { name: "Tempo על המסך הראשי" })).not.toBeInTheDocument();
  });

  it("offers the install after a booking, and 'not now' keeps it away for 30 days", async () => {
    const event = offerInstall("dismissed");
    renderAt("/");
    const card = await screen.findByRole("region", { name: "Tempo על המסך הראשי" });
    await userEvent.click(within(card).getByRole("button", { name: "התקנה" }));
    expect(event.prompt).toHaveBeenCalledOnce();

    offerInstall();
    await userEvent.click(
      within(await screen.findByRole("region", { name: "Tempo על המסך הראשי" })).getByRole("button", {
        name: "לא עכשיו",
      }),
    );
    expect(screen.queryByRole("region", { name: "Tempo על המסך הראשי" })).not.toBeInTheDocument();
    expect(installDismissed()).toBe(true);
    // The profile row stays: it is the permanent way in.
  });

  it("remembers a dismissal for 30 days, not longer", () => {
    const now = Date.UTC(2026, 9, 18);
    dismissInstall(now);
    expect(installDismissed(now + 29 * day)).toBe(true);
    expect(installDismissed(now + 30 * day)).toBe(false);
  });
});
