import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBudget, firstScreenFiles } from "./bundle-budget.mjs";

// The shape of Vite's .vite/manifest.json: one entry per source module that became a chunk.
const manifest = {
  "index.html": { file: "assets/index.js", isEntry: true, imports: ["_vendor.js"], dynamicImports: ["src/Home.tsx"] },
  "_vendor.js": { file: "assets/vendor.js" },
  "_shared.js": { file: "assets/shared.js", imports: ["_vendor.js"] },
  "src/Home.tsx": {
    file: "assets/Home.js",
    isDynamicEntry: true,
    imports: ["_shared.js"],
    dynamicImports: ["src/Qr.tsx"],
  },
  "src/Qr.tsx": { file: "assets/Qr.js", isDynamicEntry: true, imports: ["_qr-lib.js"] },
  "_qr-lib.js": { file: "assets/qr-lib.js" },
  "src/Other.tsx": { file: "assets/Other.js", isDynamicEntry: true, imports: ["_shared.js"] },
};

describe("firstScreenFiles", () => {
  it("takes the entry and the first screen with their static imports, not their dynamic ones", () => {
    assert.deepEqual(firstScreenFiles(manifest, ["src/Home.tsx"]).sort(), [
      "assets/Home.js",
      "assets/index.js",
      "assets/shared.js",
      "assets/vendor.js",
    ]);
  });

  it("counts a chunk shared by the entry and the screen once", () => {
    const files = firstScreenFiles(manifest, ["src/Home.tsx", "src/Other.tsx"]);
    assert.equal(files.filter((f) => f === "assets/shared.js").length, 1);
  });

  it("fails loudly when the first screen isn't in the manifest (a renamed file)", () => {
    assert.throws(() => firstScreenFiles(manifest, ["src/Gone.tsx"]), /src\/Gone\.tsx/);
  });
});

describe("checkBudget", () => {
  const sizes = {
    "assets/index.js": 60_000,
    "assets/vendor.js": 40_000,
    "assets/Home.js": 6_000,
    "assets/shared.js": 4_000,
  };
  const files = Object.keys(sizes);

  it("passes at or under the budget, with the total in KiB", () => {
    const result = checkBudget(files, (f) => sizes[f], 110_000 / 1024);
    assert.equal(result.ok, true);
    assert.equal(result.totalKiB.toFixed(1), "107.4");
  });

  it("fails over the budget and lists the biggest files first", () => {
    const result = checkBudget(files, (f) => sizes[f], 100);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.files.map((f) => f.file),
      ["assets/index.js", "assets/vendor.js", "assets/Home.js", "assets/shared.js"],
    );
  });
});
