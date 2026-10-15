import { useCallback, useState } from "react";
import { useFragmentSecret } from "./fragment";

export type LinkKind = "invite" | "join";

const keys: Record<LinkKind, string> = {
  invite: "tempo.client-web.pending-invite",
  join: "tempo.client-web.pending-join",
};

function stored(kind: LinkKind): string | null {
  try {
    return window.sessionStorage.getItem(keys[kind]);
  } catch {
    return null;
  }
}

function store(kind: LinkKind, value: string | null): void {
  try {
    if (value) window.sessionStorage.setItem(keys[kind], value);
    else window.sessionStorage.removeItem(keys[kind]);
  } catch {
    // Storage blocked: the link then works only for a visitor who is already signed in.
  }
}

/**
 * The secret of an invitation or join link. It comes from the fragment (`useFragmentSecret`) and is kept in
 * sessionStorage, so it survives the round trip to the Hosted UI when the visitor has to sign in or sign up
 * first. sessionStorage belongs to this tab only and is gone when the tab closes; `clear` drops it once used.
 */
export function useLinkSecret(kind: LinkKind): { secret: string | null; clear: () => void } {
  const fromFragment = useFragmentSecret();
  const [secret] = useState(() => {
    if (fromFragment) store(kind, fromFragment);
    return fromFragment ?? stored(kind);
  });
  const clear = useCallback(() => store(kind, null), [kind]);
  return { secret, clear };
}
