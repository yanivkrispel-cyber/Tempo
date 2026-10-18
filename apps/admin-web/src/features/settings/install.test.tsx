import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { listenForInstall, resetInstallForTests } from "../../app/install";
import { routes } from "../../app/routes";
import { apiStub, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

// Board #347, P-3: the console installs from a row in the settings, never on the first visit. Android and desktop
// take the browser's own prompt; an iPhone gets the steps; nothing shows when it already runs installed.

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const studio = sampleMe.memberships[0]!;

function renderSettings() {
  const me = { ...sampleMe, memberships: [membershipAs("owner")] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET /api/v1/organizations/${studio.organization.id}`]: { ...studio.organization, version: "1" },
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: ["/o/neshima/settings"] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
}

function offerInstall() {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => listenForInstall(window));
afterEach(() => {
  resetInstallForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("installing the console from the settings (P-3)", () => {
  it("takes the browser's own prompt, and the row goes once installed", async () => {
    renderSettings();
    await screen.findByRole("heading", { level: 1, name: "הגדרות הסטודיו" });
    expect(screen.queryByRole("button", { name: /התקנת האפליקציה/ })).not.toBeInTheDocument();

    const event = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    const section = await screen.findByRole("region", { name: "האפליקציה בטלפון ובמחשב" });
    await userEvent.click(within(section).getByRole("button", { name: /התקנת האפליקציה/ }));
    expect(event.prompt).toHaveBeenCalledOnce();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("region", { name: "האפליקציה בטלפון ובמחשב" })).not.toBeInTheDocument();
  });

  it("shows an iPhone the steps", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(iphone);
    renderSettings();
    await userEvent.click(await screen.findByRole("button", { name: /התקנת האפליקציה/ }));
    const sheet = await screen.findByRole("dialog", { name: "התקנה באייפון" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(3);
    expect(sheet).toHaveTextContent("הוספה למסך הבית");
  });

  it("says nothing when the console already runs installed", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)",
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    renderSettings();
    await screen.findByRole("heading", { level: 1, name: "הגדרות הסטודיו" });
    offerInstall();
    expect(screen.queryByRole("button", { name: /התקנת האפליקציה/ })).not.toBeInTheDocument();
  });
});

describe("a prompt the browser rejects", () => {
  it("does not leave the row offering a prompt that is gone", async () => {
    renderSettings();
    await screen.findByRole("heading", { level: 1, name: "הגדרות הסטודיו" });
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
      userChoice: new Promise(() => {}),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    await userEvent.click(await screen.findByRole("button", { name: /התקנת האפליקציה/ }));
    expect(event.prompt).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "האפליקציה בטלפון ובמחשב" })).not.toBeInTheDocument(),
    );
  });
});
