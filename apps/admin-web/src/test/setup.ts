import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, beforeAll } from "vitest";

// A browser never focuses an element inside an `inert` subtree (HTML, "inert"); jsdom does. Without this a test can pass
// on a focus() that a real browser ignores: the console's drawer gave focus back to its opener while the opener's bar was
// still inert, so on a phone focus fell to the page (found in the after-merge review of #320).
if (typeof HTMLElement !== "undefined") {
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (this.closest("[inert]")) return;
    focus.call(this, options);
  };
}

// Pages are lazy chunks (board #511, S-3). Loading them all once per file keeps a page's first render as quick as it
// was before the split, so a busy run can't push a `findBy` past its timeout. Imported here, not at the top, so a test
// file's `vi.mock` is already in place.
beforeAll(async () => {
  const { routes } = await import("../app/routes");
  const loads: Promise<unknown>[] = [];
  const visit = (list: RouteObject[]) => {
    for (const route of list) {
      const preload = (route.handle as { preload?: () => Promise<unknown> } | undefined)?.preload;
      if (preload) loads.push(preload());
      if (route.children) visit(route.children);
    }
  };
  visit(routes);
  await Promise.all(loads);
});

afterEach(() => {
  cleanup();
  // A pending invitation token waits in sessionStorage (shared/utilities/linkSecret.ts).
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
    window.localStorage.clear();
  }
});
