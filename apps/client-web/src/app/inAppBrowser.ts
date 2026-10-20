/**
 * The browsers inside Instagram, Facebook and TikTok (board #404, SL-7, board ו). A link from a story opens there,
 * where Google sign-in is blocked and passkeys usually fail, and an installed app would be the social app's, not the
 * studio's. So the screens offer only the email code and the password, never Face ID or the install prompt, and after
 * booking they point to the real browser. Told by the user agent only: these browsers have no other sign.
 */

/** The app whose browser this is; `webview` is any other Android app showing the page in its own view. */
export type InAppBrowser = "instagram" | "facebook" | "tiktok" | "webview";

const kinds: [InAppBrowser, RegExp][] = [
  ["instagram", /\bInstagram\b/i],
  ["facebook", /\bFB(AN|AV|IOS|_IAB|DV|SV)\b|\bFBAN\/|\bFBAV\/|\bMessenger(ForiOS|LiteForiOS)?\b/i],
  ["tiktok", /\bTikTok\b|\bmusical_ly\b|\bBytedanceWebview\b|\btrill_/i],
  // Android's own WebView says `; wv)` (developer.chrome.com, "User-Agent strings"); Chrome itself never does.
  ["webview", /\bAndroid\b.*;\s?wv\)/],
];

/** Which in-app browser `agent` is, or null for a real browser (Chrome, Safari, Samsung Internet, Firefox). */
export function inAppBrowser(agent: string = currentAgent()): InAppBrowser | null {
  for (const [kind, pattern] of kinds) if (pattern.test(agent)) return kind;
  return null;
}

export function isInAppBrowser(agent?: string): boolean {
  return inAppBrowser(agent) !== null;
}

/** Where the "פתיחה בדפדפן" card sends the person: Chrome by an intent link on Android, words on an iPhone. */
export type OpenInBrowserWay = { kind: "android"; href: string } | { kind: "ios" };

/** Android opens `url` in Chrome through an `intent://` link; an iPhone has no such link, so it gets the steps. */
export function openInBrowserWay(url: string, agent: string = currentAgent()): OpenInBrowserWay {
  if (/\bAndroid\b/i.test(agent)) {
    const target = new URL(url);
    const href = `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=${target.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    return { kind: "android", href };
  }
  return { kind: "ios" };
}

function currentAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}
