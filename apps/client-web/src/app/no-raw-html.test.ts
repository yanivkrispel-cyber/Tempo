// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Studio-typed text (names, class and event titles, descriptions) reaches the pages through React's text nodes, which
// escape it. `dangerouslySetInnerHTML` or any other HTML sink would turn that text into markup, so no app source may
// use one: not the apps' `src`, not the shared packages, and not the hand-written `public/*.js` (the service worker
// and the link-preview worker, #541 SR-38). The list of exceptions is empty on purpose: a constant, trusted snippet
// would be added here with the reason.
const allowed: readonly string[] = [];

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sinks =
  /dangerouslySetInnerHTML|\.(inner|outer)HTML\s*\+?=|insertAdjacentHTML|document\.write|createContextualFragment/;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.test\.(ts|tsx|js)$/.test(entry.name) ? [path] : [];
  });
}

function dirsUnder(parent: string): string[] {
  const root = join(repoRoot, parent);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

function offendersIn(files: string[]): string[] {
  return files
    .filter((file) => sinks.test(readFileSync(file, "utf8")))
    .map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
    .filter((file) => !allowed.includes(file));
}

describe("raw HTML", () => {
  it("is never injected by an app: no HTML sink in apps/*/src", () => {
    const files = dirsUnder("apps").flatMap((app) => sourceFiles(join(app, "src")));
    expect(files.length).toBeGreaterThan(100);
    expect(offendersIn(files)).toEqual([]);
  });

  it("is never injected by the shared packages or the apps' hand-written public scripts", () => {
    const files = [
      ...dirsUnder("packages").flatMap((pkg) => sourceFiles(join(pkg, "src"))),
      ...dirsUnder("apps").flatMap((app) => sourceFiles(join(app, "public"))),
    ];
    expect(files.some((file) => file.endsWith("_worker.js"))).toBe(true);
    expect(files.some((file) => file.endsWith("sw.js"))).toBe(true);
    expect(files.some((file) => file.includes("api-client"))).toBe(true);
    expect(offendersIn(files)).toEqual([]);
  });

  it("catches every sink it names", () => {
    for (const line of [
      "el.innerHTML = x",
      "el.innerHTML += x",
      "el.outerHTML = x",
      "el.insertAdjacentHTML('beforeend', x)",
      "document.write(x)",
      "range.createContextualFragment(x)",
      "<div dangerouslySetInnerHTML={{ __html: x }} />",
    ])
      expect(sinks.test(line), line).toBe(true);
    expect(sinks.test("el.textContent = x")).toBe(false);
  });
});
