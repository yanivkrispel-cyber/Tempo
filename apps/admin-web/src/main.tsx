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
import { readAppConfig } from "./auth/config";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before the first render: Chrome may offer the install before any screen mounts (board #347, P-3).
listenForInstall();
const config = readAppConfig();
// A tab left open across a deploy asks for chunks the new deploy no longer has: load the new version once.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadedForChunks()) return;
  event.preventDefault();
  window.location.reload();
});
// The first page's chunk downloads alongside the entry's work and `POST /session`, not after them (board #511).
preloadScreen(routes, window.location.pathname);
const auth = config.auth ? new AuthClient({ config: config.auth, app: "admin-web" }) : null;

createRoot(root).render(
  <StrictMode>
    <App router={createBrowserRouter(routes)} auth={auth} apiUrl={config.apiUrl} />
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
