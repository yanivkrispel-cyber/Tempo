import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TypeScript 6 deprecates `moduleResolution: node` (node10). The infrastructure used to silence that with
 * `ignoreDeprecations`; it now resolves like Node 16+ (#208 U4 follow-up), with the Vitest config as `.mts` so it
 * stays an ES module under `module: node16` (TS1479).
 */
describe("the infrastructure's TypeScript settings", () => {
  const tsconfig = JSON.parse(readFileSync(join(__dirname, "../../tsconfig.json"), "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };

  it("resolves modules as Node 16+ does, without silencing deprecations", () => {
    expect(tsconfig.compilerOptions.moduleResolution).toBe("node16");
    expect(tsconfig.compilerOptions.module).toBe("node16");
    expect(tsconfig.compilerOptions.ignoreDeprecations).toBeUndefined();
  });
});
