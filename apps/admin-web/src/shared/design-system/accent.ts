/**
 * The eight accents a studio may choose (WL2, docs/35 section 3). The colours live in the design system's tokens
 * (`[data-accent="<id>"]` in tokens.css); the app only names the accent on `<html>`. The ids and labels mirror
 * `@tempo/design-system/tokens.json` (accent.test.ts keeps them equal) so the bundle does not carry the whole file.
 * `ground` is the accent's light `--brand`: the colour a home-screen icon is drawn on, whatever the console's theme
 * (the API's `Brand.Accents`).
 */
export const ACCENTS = [
  { id: "sage", ground: "#56735b", label: "מרווה" },
  { id: "olive", ground: "#6b6e43", label: "זית" },
  { id: "ocean", ground: "#4a7088", label: "אוקיינוס" },
  { id: "plum", ground: "#7a607c", label: "שזיף" },
  { id: "rose", ground: "#855f65", label: "ורד" },
  { id: "terracotta", ground: "#8c5d4b", label: "טרקוטה" },
  { id: "sand", ground: "#7c664c", label: "חול" },
  { id: "graphite", ground: "#6e6a65", label: "גרפיט" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const DEFAULT_ACCENT: AccentId = "sage";

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && ACCENTS.some((accent) => accent.id === value);
}

/** Puts the accent on `<html>`; anything that is not one of the eight becomes sage. Returns the accent applied. */
export function applyAccent(id: string | null | undefined, root: HTMLElement = document.documentElement): AccentId {
  const accent = isAccentId(id) ? id : DEFAULT_ACCENT;
  root.setAttribute("data-accent", accent);
  return accent;
}
