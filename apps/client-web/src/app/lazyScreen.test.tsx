import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrefetchScreens } from "./lazyScreen";

const loader = () => vi.fn(() => Promise.resolve({}));

function setConnection(connection: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
}

describe("PrefetchScreens (board #530, O2)", () => {
  afterEach(() => {
    cleanup();
    setConnection(undefined);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the screens once the browser is idle, not while the screen paints", () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => ((idle = callback), 7));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const loads = [loader(), loader()];
    render(<PrefetchScreens loads={loads} />);

    for (const load of loads) expect(load).not.toHaveBeenCalled();
    idle!();
    for (const load of loads) expect(load).toHaveBeenCalledOnce();
  });

  it("falls back to a timer where there's no requestIdleCallback, and cancels it on unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const early = loader();
    render(<PrefetchScreens loads={[early]} />).unmount();
    vi.advanceTimersByTime(5000);
    expect(early).not.toHaveBeenCalled();

    const load = loader();
    render(<PrefetchScreens loads={[load]} />);
    vi.advanceTimersByTime(1000);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(load).toHaveBeenCalledOnce();
  });

  it.each([{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }])(
    "loads nothing ahead on %o",
    (connection) => {
      vi.useFakeTimers();
      vi.stubGlobal("requestIdleCallback", undefined);
      setConnection(connection);
      const load = loader();
      render(<PrefetchScreens loads={[load]} />);
      vi.advanceTimersByTime(5000);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it("ignores a chunk that fails to load: the screen retries when it renders", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const failing = vi.fn(() => Promise.reject(new Error("offline")));
    render(<PrefetchScreens loads={[failing]} />);
    vi.advanceTimersByTime(1500);
    expect(failing).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
  });
});
