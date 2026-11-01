import { useApi } from "../api/ApiProvider";
import { useAuth } from "../auth/AuthProvider";
import { STUDIO_CHOICE_KEY } from "../features/member/studioChoice";
import { forgetPushOnSignOut } from "./push";

/**
 * What a member's visits leave on this device that belongs to them, not to the device: the pass count per studio
 * (board #537, O2) and the studio chosen in the switcher. The device's own answers (the Face ID offer, the install
 * banner) stay, and so does a pending invitation or join link, which the next sign-in is for.
 */
const isPersonKey = (key: string) => key.startsWith("tempo.client-web.passes.") || key === STUDIO_CHOICE_KEY;

/** Removes the signed-in person's keys from this device's storage (#541 SR-34). */
export function forgetPersonOnDevice(): void {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
    for (const key of keys) if (key && isPersonKey(key)) window.localStorage.removeItem(key);
  } catch {
    // Storage blocked: there is nothing on the device to forget.
  }
}

/**
 * Every sign-out button: a shared browser must not keep this member's push (docs/30 section 4.3) or their keys
 * (#541 SR-33, SR-34). Forgetting the push never holds the sign-out for more than a few seconds.
 */
export function useSignOut(): () => Promise<void> {
  const api = useApi();
  const { client } = useAuth();
  return async () => {
    forgetPersonOnDevice();
    try {
      await forgetPushOnSignOut(api);
    } finally {
      client?.signOut();
    }
  };
}
