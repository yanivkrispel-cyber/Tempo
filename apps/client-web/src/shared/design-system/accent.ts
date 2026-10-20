/**
 * The eight accents a studio may choose (WL2, docs/35 section 3). The colours live in the design system's tokens
 * (`[data-accent="<id>"]` in tokens.css); the app only names the accent on `<html>`. The ids and labels mirror
 * `@tempo/design-system/tokens.json` (accent.test.ts keeps them equal) so the bundle does not carry the whole file.
 */
export const ACCENTS = [
  { id: "sage", label: "מרווה" },
  { id: "olive", label: "זית" },
  { id: "ocean", label: "אוקיינוס" },
  { id: "plum", label: "שזיף" },
  { id: "rose", label: "ורד" },
  { id: "terracotta", label: "טרקוטה" },
  { id: "sand", label: "חול" },
  { id: "graphite", label: "גרפיט" },
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
