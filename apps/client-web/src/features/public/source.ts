// Where a visitor came from (docs/37 section 6, M-12): a studio's shared link carries `?src=<code>`. The app keeps the
// latest code with the time it was seen, for 30 days, and sends it when the visitor joins (the API keeps the first
// touch) and when they book (the last touch). The code is not personal and not secret.

export const SOURCE_KEY = "tempo.client-web.src";

/** The API's own pattern (SourceLinks.CodePattern); anything else is not a code and is not kept. */
const codePattern = /^[a-z0-9]{6,10}$/;
export const isSourceCode = (code: string) => codePattern.test(code);
const keepFor = 30 * 24 * 60 * 60_000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Keeps the `src` of the address the app opened with, when it is a valid code. */
export function captureSource(search: string, now: number = Date.now()): void {
  const code = new URLSearchParams(search).get("src");
  if (!code || !codePattern.test(code)) return;
  try {
    storage()?.setItem(SOURCE_KEY, JSON.stringify({ code, at: now }));
  } catch {
    // Storage is full or blocked: the source is lost, the visit is not.
  }
}

/** The code kept in the last 30 days, or null. */
export function currentSource(now: number = Date.now()): string | null {
  try {
    const kept = JSON.parse(storage()?.getItem(SOURCE_KEY) ?? "null") as { code?: unknown; at?: unknown } | null;
    if (!kept || typeof kept.code !== "string" || typeof kept.at !== "number") return null;
    return codePattern.test(kept.code) && now - kept.at < keepFor && kept.at <= now ? kept.code : null;
  } catch {
    return null;
  }
}
