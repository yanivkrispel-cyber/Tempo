import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches now, kept current as the window resizes or a tablet turns. Where the browser has
 * no `matchMedia` (tests in jsdom) it answers `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/**
 * A computer or a tablet held sideways: the member app puts its tabs in a column at the start. Narrower screens
 * (phones, tablets held upright) keep the bottom tab bar (D15, #317).
 */
export const WIDE_SCREEN = "(min-width: 1024px)";
