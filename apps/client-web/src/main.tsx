import "@tempo/design-system/tokens.css";
import "@tempo/design-system/base.css";
import "@tempo/design-system/components.css";

import { AuthClient } from "@tempo/api-client/auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./app/App";
import { listenForInstall } from "./app/install";
import { preloadScreen } from "./app/lazyScreen";
import { routes } from "./app/routes";
import { dressStudioHead, studioBasename, studioSlugOf } from "./app/studioPath";
import { readAppConfig } from "./auth/config";
import { captureSource } from "./features/public/source";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before the first render: Chrome can offer the install before any screen mounts (board #347, P-3).
listenForInstall();
// A shared link's `?src=` is kept before any redirect drops it (docs/37 section 6).
captureSource(window.location.search);

const config = readAppConfig();
// `/s/<slug>/` is that studio's own app (docs/35 W-4): the same screens under a basename, its manifest and icon set
// before the first render so the browser's install reads them.
const studioSlug = studioSlugOf(window.location.pathname);
const basename = studioSlug ? studioBasename(studioSlug) : undefined;
if (studioSlug) dressStudioHead(config.apiUrl, studioSlug);
// A tab left open across a deploy asks for chunks the new deploy no longer has: load the new version once.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadedForChunks()) return;
  event.preventDefault();
  window.location.reload();
});
// The first screen's chunk downloads alongside the entry's work and `POST /session`, not after them (board #511).
preloadScreen(routes, window.location.pathname, basename);
const auth = config.auth ? new AuthClient({ config: config.auth, app: "client-web", basePath: basename }) : null;

createRoot(root).render(
  <StrictMode>
    <App
      router={createBrowserRouter(routes, { basename })}
      auth={auth}
      apiUrl={config.apiUrl}
      studioSlug={studioSlug}
    />
  </StrictMode>,
);

/** True when this tab already reloaded for missing chunks in the last minute, so a broken deploy can't loop. */
function reloadedForChunks(): boolean {
  try {
    const last = Number(sessionStorage.getItem("tempo.chunkReload") ?? 0);
    if (Date.now() - last < 60_000) return true;
    sessionStorage.setItem("tempo.chunkReload", String(Date.now()));
  } catch {
    // Storage blocked: reloading without a guard could loop, so don't.
    return true;
  }
  return false;
}
