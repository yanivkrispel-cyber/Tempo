import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const ClockContext = createContext<Date | null>(null);

/** How often the screens re-read the clock: a class that starts flips from "book" to "started" within a minute. */
const tickMs = 30_000;

/**
 * The current moment for the member screens. Render code reads it from here instead of calling `Date.now()`, so a
 * render stays pure and tests can freeze time with `now`.
 */
export function ClockProvider({ now, children }: { now?: Date; children: ReactNode }) {
  const [tick, setTick] = useState(() => new Date());

  useEffect(() => {
    if (now) return;
    const timer = window.setInterval(() => setTick(new Date()), tickMs);
    return () => window.clearInterval(timer);
  }, [now]);

  return <ClockContext.Provider value={now ?? tick}>{children}</ClockContext.Provider>;
}

export function useNow(): Date {
  const now = useContext(ClockContext);
  if (!now) throw new Error("The member screens need a <ClockProvider> above them.");
  return now;
}
