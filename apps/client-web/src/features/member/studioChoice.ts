import { useSyncExternalStore } from "react";

// The studio the generic app (`/`) shows to a member of two or more, as chosen in the switcher (docs/35 W-5). One
// answer per device; a studio's own app (`/s/<slug>/`) ignores it. An id, not a secret.

export const STUDIO_CHOICE_KEY = "tempo.client-web.studio";

const listeners = new Set<() => void>();
/** The choice when storage is blocked (private mode): it lasts until the page reloads. */
let unsaved: string | null = null;

function read(): string | null {
  try {
    return window.localStorage.getItem(STUDIO_CHOICE_KEY) ?? unsaved;
  } catch {
    return unsaved;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of the app chose a studio.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STUDIO_CHOICE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The organization id this device last chose, or null. */
export function useChosenStudio(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function chooseStudio(organizationId: string): void {
  try {
    window.localStorage.setItem(STUDIO_CHOICE_KEY, organizationId);
  } catch {
    unsaved = organizationId;
  }
  for (const listener of listeners) listener();
}
