import "@tempo/design-system/tokens.css";
import "@tempo/design-system/base.css";
import "@tempo/design-system/components.css";

import { AuthClient } from "@tempo/api-client/auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./app/App";
import { listenForInstall } from "./app/install";
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
