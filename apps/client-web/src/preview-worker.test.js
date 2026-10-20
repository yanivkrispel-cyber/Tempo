import { describe, expect, it, vi } from "vitest";
import worker, { createHandler, escapeHtml, isPreviewCrawler, previewRoute, renderPreview } from "../public/_worker.js";

const API = "https://api.example";
const SESSION = "11111111-2222-3333-4444-555555555555";
const OFFER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
// Built by concatenation so no literal script tag sits in the source.
const HOSTILE = "<" + "script>alert(1)</" + 'script>"';

const WHATSAPP = "WhatsApp/2.23.20.0 A";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const studio = {
  slug: "demo",
  name: "Demo Studio",
  appName: "Demo",
  timeZone: "Asia/Jerusalem",
  coverUrl: "https://x/c.jpg",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(routes) {
  const fetchFn = vi.fn(async (url) => {
    const path = String(url).replace(API, "");
    const hit = routes[path];
    return hit === undefined ? json({}, 404) : hit instanceof Response ? hit : json(hit);
  });
  const assets = vi.fn(async () => new Response("static app", { status: 200, headers: { "x-from": "assets" } }));
  const handler = createHandler({ apiBase: API, fetchFn });
  const call = (path, ua = WHATSAPP, method = "GET") =>
    handler.fetch(new Request(`https://app.example${path}`, { method, headers: { "user-agent": ua } }), {
      ASSETS: { fetch: assets },
    });
  return { call, assets, fetchFn };
}

describe("isPreviewCrawler", () => {
  it.each([
    WHATSAPP,
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "facebookexternalhit/1.1 Facebot Twitterbot/1.0",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 (compatible; Discordbot/2.0)",
  ])("accepts %s", (ua) => expect(isPreviewCrawler(ua)).toBe(true));
  it.each([
    CHROME,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    null,
  ])("rejects %s", (ua) => expect(isPreviewCrawler(ua)).toBe(false));
});

describe("previewRoute", () => {
  it("parses the four targets", () => {
    expect(previewRoute("/s/demo")).toEqual({ slug: "demo", kind: "schedule", id: null });
    expect(previewRoute("/s/demo/")).toEqual({ slug: "demo", kind: "schedule", id: null });
    expect(previewRoute("/s/demo/prices")).toEqual({ slug: "demo", kind: "prices", id: null });
    expect(previewRoute(`/s/demo/c/${SESSION}`)).toEqual({ slug: "demo", kind: "session", id: SESSION });
    expect(previewRoute(`/s/demo/o/${OFFER}`)).toEqual({ slug: "demo", kind: "offer", id: OFFER });
  });
  it("ignores everything else", () => {
    for (const p of ["/", "/home", "/s/", "/s/demo/login", "/s/demo/c/not-an-id", "/s/Bad_Slug/", "/sx/demo"]) {
      expect(previewRoute(p)).toBeNull();
    }
  });
});

describe("renderPreview", () => {
  it("escapes hostile text everywhere", () => {
    const html = renderPreview({
      title: HOSTILE,
      description: HOSTILE,
      image: null,
      url: "https://a/?x=1&y=2",
      siteName: HOSTILE,
    });
    expect(html).not.toContain("<" + "script");
    expect(html).toContain("&lt;" + "script&gt;");
    expect(html).toContain("&quot;");
    expect(html).toContain("x=1&amp;y=2");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
  it("carries the og and twitter tags", () => {
    const html = renderPreview({ title: "T", description: "D", image: "https://api/cover", url: "https://a/s/x/" });
    expect(html).toContain('<html lang="he" dir="rtl">');
    for (const t of [
      'og:title" content="T"',
      'og:description" content="D"',
      'og:image" content="https://api/cover"',
      'og:url" content="https://a/s/x/"',
      'og:type" content="website"',
      'twitter:card" content="summary_large_image"',
    ]) {
      expect(html).toContain(t);
    }
  });
});

describe("handler", () => {
  const base = { "/api/v1/public/studios/demo": studio };

  it("renders the schedule preview for a crawler", async () => {
    const { call, assets } = setup(base);
    const res = await call("/s/demo/");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; img-src https:");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await res.text();
    expect(html).toContain("Demo Studio");
    expect(html).toContain(`${API}/api/v1/public/studios/demo/cover`);
    expect(assets).not.toHaveBeenCalled();
  });

  it("escapes a hostile studio name", async () => {
    const { call } = setup({ "/api/v1/public/studios/demo": { ...studio, name: HOSTILE } });
    const html = await (await call("/s/demo/")).text();
    expect(html).not.toContain("<" + "script");
  });

  it("uses the class for a session link and the inviter for ?src=", async () => {
    const { call } = setup({
      ...base,
      [`/api/v1/public/studios/demo/sessions/${SESSION}`]: {
        startsAt: "2026-11-02T17:00:00Z",
        classType: { name: "Pilates" },
        coverUrl: "https://x/s.jpg",
        event: null,
      },
      "/api/v1/public/studios/demo/links/abc123": { target: { kind: "session", id: SESSION }, inviterFirstName: "נגה" },
    });
    const html = await (await call(`/s/demo/c/${SESSION}?src=abc123`)).text();
    expect(html).toContain("נגה מזמינה אותך · Pilates · Demo Studio");
    expect(html).toContain(`/sessions/${SESSION}/cover`);
  });

  it("describes an offer with its price", async () => {
    const { call } = setup({
      ...base,
      [`/api/v1/public/studios/demo/products/${OFFER}`]: {
        ended: false,
        product: { name: "10 classes", priceAgorot: 90000, blurb: null },
      },
    });
    const html = await (await call(`/s/demo/o/${OFFER}`)).text();
    expect(html).toContain("10 classes · Demo Studio");
    expect(html).toContain("900 ₪");
  });

  it("passes browsers, other paths and other methods to the static app", async () => {
    const cases = [
      ["/s/demo/", CHROME],
      ["/home", WHATSAPP],
      ["/s/demo/login", WHATSAPP],
      ["/s/demo/", WHATSAPP, "POST"],
    ];
    for (const [path, ua, method] of cases) {
      const { call, assets, fetchFn } = setup(base);
      const res = await call(path, ua, method);
      expect(res.headers.get("x-from")).toBe("assets");
      expect(assets).toHaveBeenCalledTimes(1);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("passes through on API 404, 500, a missing session and a thrown error", async () => {
    for (const routes of [{}, { "/api/v1/public/studios/demo": json({}, 500) }]) {
      const { call } = setup(routes);
      expect((await call("/s/demo/")).headers.get("x-from")).toBe("assets");
    }
    const { call } = setup(base);
    expect((await call(`/s/demo/c/${SESSION}`)).headers.get("x-from")).toBe("assets");
    const assets = vi.fn(async () => new Response("app"));
    const boom = createHandler({ apiBase: API, fetchFn: () => Promise.reject(new Error("net")) });
    const req = new Request("https://app.example/s/demo/", { headers: { "user-agent": WHATSAPP } });
    await boom.fetch(req, { ASSETS: { fetch: assets } });
    expect(assets).toHaveBeenCalledTimes(1);
  });

  it("passes through when the API base was not injected", async () => {
    const assets = vi.fn(async () => new Response("app"));
    const req = new Request("https://app.example/s/demo/", { headers: { "user-agent": WHATSAPP } });
    await worker.fetch(req, { ASSETS: { fetch: assets } });
    expect(assets).toHaveBeenCalledTimes(1);
  });
});
