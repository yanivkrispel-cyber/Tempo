// node --test tools/scripts/lib/pwa-manifest.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkApp, checkManifest, manifestHref, pngSize } from "./pwa-manifest.mjs";

const APP = "https://tempo-members.pages.dev/";
const MANIFEST_URL = "https://tempo-members.pages.dev/manifest.webmanifest";

/** A PNG signature and IHDR chunk that declare the given size; enough for pngSize. */
function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function goodManifest() {
  return {
    name: "Tempo",
    short_name: "Tempo",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** A fake fetch that serves a small site from a map of absolute URL to response. */
function site(entries) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const entry = entries[String(url)];
    if (!entry) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": entry.type } });
  };
  return { fetchImpl, calls };
}

function goodSite(manifest = goodManifest()) {
  return site({
    [APP]: { type: "text/html", body: '<link rel="manifest" href="/manifest.webmanifest">' },
    [MANIFEST_URL]: { type: "application/manifest+json", body: JSON.stringify(manifest) },
    "https://tempo-members.pages.dev/icons/icon-192.png": { type: "image/png", body: png(192, 192) },
    "https://tempo-members.pages.dev/icons/icon-512.png": { type: "image/png", body: png(512, 512) },
    "https://tempo-members.pages.dev/icons/icon-maskable-512.png": { type: "image/png", body: png(512, 512) },
  });
}

test("pngSize reads the width and height from the IHDR chunk", () => {
  assert.deepEqual(pngSize(png(192, 144)), { width: 192, height: 144 });
  assert.equal(pngSize(Buffer.from("<svg/>")), null);
  assert.equal(pngSize(Buffer.alloc(10)), null);
});

test("manifestHref finds the manifest link whatever the attribute order and quotes", () => {
  assert.equal(manifestHref('<link rel="manifest" href="/manifest.webmanifest">'), "/manifest.webmanifest");
  assert.equal(manifestHref("<link href='/m.json' crossorigin rel='manifest' />"), "/m.json");
  assert.equal(manifestHref('<link rel="icon" href="/favicon.svg">'), null);
});

test("a complete manifest has no problems and names the icons to fetch", () => {
  const { problems, icons } = checkManifest(goodManifest(), MANIFEST_URL);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    icons.map((icon) => [icon.url, icon.width]),
    [
      ["https://tempo-members.pages.dev/icons/icon-192.png", 192],
      ["https://tempo-members.pages.dev/icons/icon-512.png", 512],
      ["https://tempo-members.pages.dev/icons/icon-maskable-512.png", 512],
    ],
  );
});

test("today's manifest without icons fails the way Chrome does (the Android bug of 2026-10-18)", () => {
  const { problems } = checkManifest(
    { name: "Tempo", short_name: "Tempo", start_url: "/", scope: "/", display: "standalone" },
    MANIFEST_URL,
  );
  assert.deepEqual(problems, [
    "no id",
    "no PNG icon of 192x192 for purpose any",
    "no PNG icon of 512x512 for purpose any",
    "no maskable PNG icon",
  ]);
});

test("each manifest rule is checked on its own", () => {
  const cases = [
    [{ name: undefined, short_name: undefined }, "no name or short_name"],
    [{ display: "browser" }, 'display "browser" does not install (standalone, fullscreen or minimal-ui)'],
    [{ start_url: "/app/", scope: "/console/" }, "start_url https://tempo-members.pages.dev/app/ is outside scope https://tempo-members.pages.dev/console/"],
    [{ start_url: "https://elsewhere.example/" }, "start_url https://elsewhere.example/ is outside scope https://tempo-members.pages.dev/"],
    [{ start_url: undefined }, "no start_url"],
  ];
  for (const [change, expected] of cases) {
    const { problems } = checkManifest({ ...goodManifest(), ...change }, MANIFEST_URL);
    assert.ok(problems.includes(expected), `${JSON.stringify(change)} → ${JSON.stringify(problems)}`);
  }
});

test("an SVG or a maskable-only 192 icon does not count as the 192 any icon", () => {
  const manifest = goodManifest();
  manifest.icons[0] = { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" };
  assert.ok(checkManifest(manifest, MANIFEST_URL).problems.includes("no PNG icon of 192x192 for purpose any"));
  manifest.icons[0] = { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" };
  assert.ok(checkManifest(manifest, MANIFEST_URL).problems.includes("no PNG icon of 192x192 for purpose any"));
  manifest.icons[0] = { src: "/icons/icon-192.png", sizes: "48x48 192x192", purpose: "any maskable" };
  assert.deepEqual(checkManifest(manifest, MANIFEST_URL).problems, []);
});

test("checkApp passes a complete deployed app", async () => {
  const { fetchImpl } = goodSite();
  assert.deepEqual(await checkApp(APP, { fetchImpl }), []);
});

test("checkApp fails a page without a manifest link, even when the file exists (Chrome needs the link)", async () => {
  const { fetchImpl } = goodSite();
  const withoutLink = async (url) =>
    String(url) === APP ? new Response("<html></html>", { headers: { "content-type": "text/html" } }) : fetchImpl(url);
  assert.deepEqual(await checkApp(APP, { fetchImpl: withoutLink }), ['the page has no <link rel="manifest">']);
});

test("checkApp reports an icon that is missing, not a PNG, or another size than declared", async () => {
  const { fetchImpl } = site({
    [APP]: { type: "text/html", body: '<link rel="manifest" href="/manifest.webmanifest">' },
    [MANIFEST_URL]: { type: "application/manifest+json", body: JSON.stringify(goodManifest()) },
    // A single-page app answers a missing file with index.html and 200: the content type gives it away.
    "https://tempo-members.pages.dev/icons/icon-192.png": { type: "text/html", body: "<!doctype html>" },
    "https://tempo-members.pages.dev/icons/icon-512.png": { type: "image/png", body: png(256, 256) },
  });
  assert.deepEqual(await checkApp(APP, { fetchImpl }), [
    "icon https://tempo-members.pages.dev/icons/icon-192.png answers text/html, not image/png",
    "icon https://tempo-members.pages.dev/icons/icon-512.png is 256x256, the manifest says 512x512",
    "icon https://tempo-members.pages.dev/icons/icon-maskable-512.png answers 404",
  ]);
});

test("checkApp reports a manifest that is not JSON", async () => {
  const { fetchImpl } = site({
    [APP]: { type: "text/html", body: '<link rel="manifest" href="/manifest.webmanifest">' },
    [MANIFEST_URL]: { type: "text/html", body: "<!doctype html>" },
  });
  const problems = await checkApp(APP, { fetchImpl });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^manifest https:\/\/tempo-members\.pages\.dev\/manifest\.webmanifest is not JSON/);
});
