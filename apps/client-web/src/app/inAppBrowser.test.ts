import { describe, expect, it } from "vitest";
import { inAppBrowser, isInAppBrowser, openInBrowserWay } from "./inAppBrowser";

// Real user agents of each browser (shapes as the apps send them in 2026; versions don't matter to the check).
const agents = {
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.80 (iPhone15,3; iOS 18_5; he_IL; he; scale=3.00; 1290x2796; 745012365)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.43.81 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; he_IL; 745012365)",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0.38.105;FBBV/736112345;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/he_IL;FBOP/80]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/520.0.0.47.109;]",
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_41.2.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/he Region/IL BytedanceWebview/d8a21c6",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 trill_410205 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/41.2.5 ByteLocale/he",
  lineIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.12.0",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
};

describe("inAppBrowser", () => {
  it.each([
    ["instagramIos", "instagram"],
    ["instagramAndroid", "instagram"],
    ["facebookIos", "facebook"],
    ["facebookAndroid", "facebook"],
    ["tiktokIos", "tiktok"],
    ["tiktokAndroid", "tiktok"],
    ["lineIos", "line"],
    ["androidWebView", "webview"],
  ] as const)("tells %s", (name, kind) => {
    expect(inAppBrowser(agents[name])).toBe(kind);
    expect(isInAppBrowser(agents[name])).toBe(true);
  });

  it.each(["chromeAndroid", "chromeDesktop", "safariIos", "chromeIos", "safariMac", "samsungInternet"] as const)(
    "leaves the real browser %s alone",
    (name) => {
      expect(inAppBrowser(agents[name])).toBeNull();
      expect(isInAppBrowser(agents[name])).toBe(false);
    },
  );
});

describe("openInBrowserWay", () => {
  const url = "https://tempo-members.pages.dev/s/studio-breath/c/7f3a?src=ab12cd";

  it("sends Android to Chrome by an intent link that keeps the path, the query and a fallback", () => {
    const way = openInBrowserWay(url, agents.instagramAndroid);
    expect(way).toEqual({
      kind: "android",
      href:
        "intent://tempo-members.pages.dev/s/studio-breath/c/7f3a?src=ab12cd#Intent;scheme=https;package=com.android.chrome;" +
        `S.browser_fallback_url=${encodeURIComponent(url)};end`,
    });
  });

  it("gives an iPhone the steps, since iOS has no link that opens Safari", () => {
    expect(openInBrowserWay(url, agents.instagramIos)).toEqual({ kind: "ios" });
  });
});
