// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Studio-typed text (names, class and event titles, descriptions) reaches the pages through React's text nodes, which
// escape it. `dangerouslySetInnerHTML` would turn that text into markup, so no app source may use it. The list of
// exceptions is empty on purpose: a constant, trusted snippet would be added here with the reason.
const allowed: readonly string[] = [];

const appsRoot = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("raw HTML in the apps", () => {
  it("is never injected: no app source uses dangerouslySetInnerHTML", () => {
    const apps = readdirSync(appsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const files = apps.flatMap((app) => sourceFiles(join(appsRoot, app.name, "src")));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((file) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(readFileSync(file, "utf8")))
      .map((file) => relative(appsRoot, file).replaceAll("\\", "/"))
      .filter((file) => !allowed.includes(file));
    expect(offenders).toEqual([]);
  });
});
