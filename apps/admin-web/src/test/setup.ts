import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

afterEach(() => {
  cleanup();
  // A pending invitation token waits in sessionStorage (shared/utilities/linkSecret.ts).
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
    window.localStorage.clear();
  }
});
