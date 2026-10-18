/**
 * Installability rules for a deployed web app (board #347, K2): what Chrome on Android needs before it offers
 * "Install app", checked from the outside so a deploy can't silently lose it again. On 2026-10-18 neither app
 * installed: both manifests had no icons (`manifest-missing-suitable-icon`, `no-acceptable-icon`).
 *
 * The rules: a name, an `id`, a `start_url` inside the `scope`, a `display` that installs, a PNG icon of 192x192 and
 * one of 512x512 for purpose `any`, and a maskable PNG icon. Every one of those icons must answer 200 `image/png`
 * at the size the manifest declares.
 */

const INSTALLABLE_DISPLAYS = new Set(["standalone", "fullscreen", "minimal-ui"]);

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes) {
  const buffer = Buffer.from(bytes);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24 || signature.some((byte, i) => buffer[i] !== byte)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** The href of the page's `<link rel="manifest">`, or null. */
export function manifestHref(html) {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (rel?.toLowerCase() === "manifest" && href) return href;
  }
  return null;
}

function purposes(icon) {
  return (icon.purpose ?? "any").toLowerCase().split(/\s+/).filter(Boolean);
}

function isPng(icon) {
  return icon.type ? icon.type.toLowerCase() === "image/png" : /\.png(\?|#|$)/i.test(icon.src ?? "");
}

function squareSizes(icon) {
  return (icon.sizes ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((size) => /^(\d+)x(\d+)$/.exec(size))
    .filter((match) => match && match[1] === match[2])
    .map((match) => Number(match[1]));
}

function inScope(url, scope) {
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

/**
 * Checks a parsed manifest. Returns the problems and the icons the rules rely on (absolute URL and declared width),
 * which `checkApp` then fetches.
 */
export function checkManifest(manifest, manifestUrl) {
  const problems = [];
  if (!manifest.name && !manifest.short_name) problems.push("no name or short_name");
  if (!manifest.id) problems.push("no id");

  if (!manifest.start_url) {
    problems.push("no start_url");
  } else {
    const start = new URL(manifest.start_url, manifestUrl);
    const scope = new URL(manifest.scope ?? ".", manifest.scope ? manifestUrl : start);
    if (!inScope(start, scope)) problems.push(`start_url ${start.href} is outside scope ${scope.href}`);
  }

  const display = manifest.display ?? "browser";
  if (!INSTALLABLE_DISPLAYS.has(display)) {
    problems.push(`display "${display}" does not install (standalone, fullscreen or minimal-ui)`);
  }

  const pngIcons = (manifest.icons ?? []).filter((icon) => icon.src && isPng(icon));
  const needed = [];
  const pick = (predicate, size, problem) => {
    const icon = pngIcons.find((candidate) => predicate(candidate) && (!size || squareSizes(candidate).includes(size)));
    if (!icon) {
      problems.push(problem);
      return;
    }
    const width = size ?? Math.max(...squareSizes(icon), 0);
    const url = new URL(icon.src, manifestUrl).href;
    if (!needed.some((entry) => entry.url === url && entry.width === width)) needed.push({ url, width });
  };
  pick((icon) => purposes(icon).includes("any"), 192, "no PNG icon of 192x192 for purpose any");
  pick((icon) => purposes(icon).includes("any"), 512, "no PNG icon of 512x512 for purpose any");
  pick((icon) => purposes(icon).includes("maskable") && squareSizes(icon).length > 0, null, "no maskable PNG icon");

  return { problems, icons: needed };
}

async function fetchIcon({ url, width }, fetchImpl) {
  const response = await fetchImpl(url);
  if (response.status !== 200) return `icon ${url} answers ${response.status}`;
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  if (type !== "image/png") return `icon ${url} answers ${type || "no content type"}, not image/png`;
  const size = pngSize(Buffer.from(await response.arrayBuffer()));
  if (!size) return `icon ${url} is not a PNG`;
  if (size.width !== width || size.height !== width) {
    return `icon ${url} is ${size.width}x${size.height}, the manifest says ${width}x${width}`;
  }
  return null;
}

/** Checks a deployed app from its address: the page's manifest link, the manifest, and every icon the rules use. */
export async function checkApp(appUrl, { fetchImpl = fetch } = {}) {
  const page = await fetchImpl(appUrl);
  if (page.status !== 200) return [`the page answers ${page.status}`];
  const href = manifestHref(await page.text());
  if (!href) return ['the page has no <link rel="manifest">'];

  const manifestUrl = new URL(href, appUrl).href;
  const response = await fetchImpl(manifestUrl);
  if (response.status !== 200) return [`manifest ${manifestUrl} answers ${response.status}`];
  let manifest;
  try {
    manifest = JSON.parse(await response.text());
  } catch (error) {
    return [`manifest ${manifestUrl} is not JSON (${error.message})`];
  }

  const { problems, icons } = checkManifest(manifest, manifestUrl);
  for (const icon of icons) {
    const problem = await fetchIcon(icon, fetchImpl);
    if (problem) problems.push(problem);
  }
  return problems;
}
