/**
 * The eight accents a studio may choose (WL2, docs/35 section 3). The colours live in the design system's tokens
 * (`[data-accent="<id>"]` in tokens.css); the app only names the accent on `<html>`. The ids and labels mirror
 * `@tempo/design-system/tokens.json` (accent.test.ts keeps them equal) so the bundle does not carry the whole file;
 * `brand` is each accent's light brand colour.
 */
export const ACCENTS = [
  { id: "sage", label: "מרווה", brand: "#56735b" },
  { id: "olive", label: "זית", brand: "#6b6e43" },
  { id: "ocean", label: "אוקיינוס", brand: "#4a7088" },
  { id: "plum", label: "שזיף", brand: "#7a607c" },
  { id: "rose", label: "ורד", brand: "#855f65" },
  { id: "terracotta", label: "טרקוטה", brand: "#8c5d4b" },
  { id: "sand", label: "חול", brand: "#7c664c" },
  { id: "graphite", label: "גרפיט", brand: "#6e6a65" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const DEFAULT_ACCENT: AccentId = "sage";

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && ACCENTS.some((accent) => accent.id === value);
}

/** The accent whose light brand colour a studio's manifest names as its `theme_color` (docs/35 W-4); null if none. */
export function accentOfThemeColor(color: unknown): AccentId | null {
  if (typeof color !== "string") return null;
  return ACCENTS.find((accent) => accent.brand === color.toLowerCase())?.id ?? null;
}

/** Puts the accent on `<html>`; anything that is not one of the eight becomes sage. Returns the accent applied. */
export function applyAccent(id: string | null | undefined, root: HTMLElement = document.documentElement): AccentId {
  const accent = isAccentId(id) ? id : DEFAULT_ACCENT;
  root.setAttribute("data-accent", accent);
  return accent;
}
