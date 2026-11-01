// How many live passes this device last showed per studio, so the profile's skeleton takes the loaded card's height
// and the cards below it do not jump (board #537, O2). A count, not personal data; a blocked storage just forgets it.

const key = (organizationId: string) => `tempo.client-web.passes.${organizationId}`;

/** The live passes the profile last showed for this studio, or null when it never did on this device. */
export function rememberedPassCount(organizationId: string): number | null {
  try {
    const saved = window.localStorage.getItem(key(organizationId));
    const count = Number(saved);
    return saved !== null && Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

export function rememberPassCount(organizationId: string, count: number): void {
  try {
    window.localStorage.setItem(key(organizationId), String(count));
  } catch {
    // Private mode: the skeleton keeps the one-pass height.
  }
}

/** The passes card's height on a phone: 188 px with one pass (or none), and 122 px for each pass after it. */
export const passesCardHeight = (count: number | null) => 188 + 122 * Math.min(Math.max((count ?? 1) - 1, 0), 4);
