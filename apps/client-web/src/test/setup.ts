import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, beforeAll } from "vitest";

// Screens are lazy chunks (board #511, S-3). Loading them all once per file keeps a screen's first render as quick as
// it was before the split, so a busy run can't push a `findBy` past its timeout. Imported here, not at the top, so a
// test file's `vi.mock` is already in place.
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
  // A pending invitation or join secret waits in sessionStorage (shared/utilities/linkSecret.ts).
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
    window.localStorage.clear();
  }
});
