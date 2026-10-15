import "@tempo/design-system/tokens.css";
import "@tempo/design-system/base.css";
import "@tempo/design-system/components.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./app/App";
import { routes } from "./app/routes";
import { AuthClient } from "./auth/authClient";
import { readAppConfig } from "./auth/config";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

const config = readAppConfig();
const auth = config.auth ? new AuthClient({ config: config.auth }) : null;

createRoot(root).render(
  <StrictMode>
    <App router={createBrowserRouter(routes)} auth={auth} apiUrl={config.apiUrl} />
  </StrictMode>
);
