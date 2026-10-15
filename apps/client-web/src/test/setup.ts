import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // A pending invitation or join secret waits in sessionStorage (shared/utilities/linkSecret.ts).
  window.sessionStorage.clear();
  window.localStorage.clear();
});
