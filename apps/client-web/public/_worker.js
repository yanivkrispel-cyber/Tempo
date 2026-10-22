// Cloudflare Pages advanced-mode worker (SL-9, board SO6). Link previews for shared studio links.
//
// Crawlers do not run JavaScript, so a link to /s/<slug>/... shows a bare address. A request to /s/* from a known
// preview crawler gets a small HTML page with Open Graph tags built from the public API. Every other request, and
// any API failure, goes to the static app untouched (env.ASSETS.fetch), so the `_headers` Content-Security-Policy
// and the single-page-app fallback are exactly the ones Pages applies today.
//
// The API origin is written into API_BASE at build time by the `tempoPreviewWorker` plugin in vite.config.ts, from
// VITE_API_URL (the variable the app already uses). Without it the worker only passes requests through.

const API_BASE = "__TEMPO_API_URL__";

const CRAWLER_PATTERN =
  /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|Slack-ImgProxy|LinkedInBot|Discordbot|Applebot|SkypeUriPreview|Viber|Signal/i;

/** True for the link-preview fetchers of the chat and social apps. Googlebot is left out on purpose (SEO stays with the app). */
export function isPreviewCrawler(userAgent) {
  return typeof userAgent === "string" && CRAWLER_PATTERN.test(userAgent);
}

const UUID = "[0-9a-fA-F-]{36}";

/**
 * Parses /s/<slug>/..., the four shared-link targets. Returns null for anything else.
 * @returns {{ slug: string, kind: "schedule" | "session" | "offer" | "prices", id: string | null } | null}
 */
export function previewRoute(pathname) {
  const match = /^\/s\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1];
  const rest = (match[2] ?? "").replace(/\/+$/, "");
  if (rest === "") return { slug, kind: "schedule", id: null };
  if (rest === "/prices") return { slug, kind: "prices", id: null };
  const session = new RegExp(`^/c/(${UUID})$`).exec(rest);
  if (session) return { slug, kind: "session", id: session[1] };
  const offer = new RegExp(`^/o/(${UUID})$`).exec(rest);
  if (offer) return { slug, kind: "offer", id: offer[1] };
  return null;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * The preview page. Every interpolated value is HTML-escaped; studio text is data, never markup (S-C).
 * `largeImage` is true for a real cover; the icon fallback is square, so it gets the small Twitter card.
 * @param {{ title: string, description: string, image: string | null, largeImage?: boolean, url: string, siteName?: string }} data
 */
export function renderPreview(data) {
  const tags = [
    ["og:type", "website"],
    ["og:title", data.title],
    ["og:description", data.description],
    ["og:url", data.url],
    ["twitter:card", data.image && data.largeImage !== false ? "summary_large_image" : "summary"],
    ["twitter:title", data.title],
    ["twitter:description", data.description],
  ];
  if (data.siteName) tags.push(["og:site_name", data.siteName]);
  if (data.image) {
    tags.push(["og:image", data.image], ["twitter:image", data.image]);
  }
  const metas = tags.map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}">`).join("\n");
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.title)}</title>
<meta name="description" content="${escapeHtml(data.description)}">
${metas}
</head>
<body><h1>${escapeHtml(data.title)}</h1><p>${escapeHtml(data.description)}</p></body>
</html>
`;
}

const PREVIEW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
  "content-security-policy": "default-src 'none'; img-src https:",
  "x-content-type-options": "nosniff",
};

function formatWhen(startsAt, timeZone) {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(startsAt));
  } catch {
    return "";
  }
}

function shekels(agorot) {
  const value = agorot / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)} ₪`;
}

async function getJson(fetchFn, url) {
  const response = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  return response.json();
}

/** Builds the preview data for a route, or null when the API has nothing to show. */
async function buildPreview(route, url, apiBase, fetchFn) {
  const studioPath = `${apiBase}/api/v1/public/studios/${encodeURIComponent(route.slug)}`;
  const src = url.searchParams.get("src");
  const [studio, link] = await Promise.all([
    getJson(fetchFn, studioPath),
    src && /^[A-Za-z0-9_-]{1,40}$/.test(src)
      ? getJson(fetchFn, `${studioPath}/links/${encodeURIComponent(src)}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!studio || typeof studio.name !== "string") return null;

  const inviter = typeof link?.inviterFirstName === "string" && link.inviterFirstName ? link.inviterFirstName : null;
  const headline = (name) => (inviter ? `${inviter} מזמינה אותך · ${name}` : name);
  const origin = `${url.origin}/s/${route.slug}`;
  let title = headline(studio.name);
  let description = `לוח השיעורים והרשמה ב${studio.name}`;
  let pageUrl = `${origin}/`;
  // C-2: always an image. Without a cover the API's /cover redirects to the studio's 512 px icon (its logo, or its
  // initials on its accent), so every preview has a picture at no cost of its own.
  let image = `${studioPath}/cover`;
  let largeImage = Boolean(studio.coverUrl);

  if (route.kind === "session") {
    const session = await getJson(fetchFn, `${studioPath}/sessions/${route.id}`);
    if (!session?.classType?.name) return null;
    title = headline(`${session.classType.name} · ${studio.name}`);
    const when = formatWhen(session.startsAt, studio.timeZone);
    description = [when, session.event?.description].filter(Boolean).join(" · ") || description;
    pageUrl = `${origin}/c/${route.id}`;
    if (session.coverUrl) {
      image = `${studioPath}/sessions/${route.id}/cover`;
      largeImage = true;
    }
  } else if (route.kind === "offer") {
    const detail = await getJson(fetchFn, `${studioPath}/products/${route.id}`);
    const product = detail?.product;
    if (!product?.name) return null;
    title = headline(`${product.name} · ${studio.name}`);
    description =
      [product.priceAgorot == null ? null : shekels(product.priceAgorot), product.blurb].filter(Boolean).join(" · ") ||
      description;
    pageUrl = `${origin}/o/${route.id}`;
  } else if (route.kind === "prices") {
    title = headline(`מחירון · ${studio.name}`);
    description = `כרטיסיות ומנויים ב${studio.name}`;
    pageUrl = `${origin}/prices`;
  }
  return { title, description, image, largeImage, url: pageUrl, siteName: studio.appName || studio.name };
}

/**
 * The Pages worker. `apiBase` is the API origin; `fetchFn` is injectable for tests.
 * Anything that is not a preview crawler asking for a /s/ link, or any failure, is the static app, untouched.
 */
export function createHandler({ apiBase, fetchFn = (...args) => fetch(...args) }) {
  return {
    async fetch(request, env) {
      const passthrough = () => env.ASSETS.fetch(request);
      if (!apiBase || apiBase.startsWith("__") || request.method !== "GET") return passthrough();
      if (!isPreviewCrawler(request.headers.get("user-agent"))) return passthrough();
      const url = new URL(request.url);
      const route = previewRoute(url.pathname);
      if (!route) return passthrough();
      try {
        const data = await buildPreview(route, url, apiBase.replace(/\/+$/, ""), fetchFn);
        if (!data) return passthrough();
        return new Response(renderPreview(data), { status: 200, headers: PREVIEW_HEADERS });
      } catch {
        return passthrough();
      }
    },
  };
}

export default createHandler({ apiBase: API_BASE });
