import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/** The value after `#`, or null when it is empty or malformed. */
export function parseFragment(hash: string): string | null {
  try {
    const value = decodeURIComponent(hash.replace(/^#/, "")).trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * The secret in this page's fragment (`/invite#<token>`, `/join#<code>`), read once.
 * The fragment is then dropped from the address bar and the history entry, so it is
 * not left behind for a screenshot, a copied URL or the back button. Browsers never
 * send the fragment to a server (docs/26 section 5.3).
 */
export function useFragmentSecret(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [secret] = useState(() => parseFragment(location.hash));

  useEffect(() => {
    if (location.hash) {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  return secret;
}
