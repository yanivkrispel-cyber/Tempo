#!/usr/bin/env node
// Fails the app's build when its first screen's JavaScript grows past the budget (board #511, S-3).
// Run from an app folder after `vite build` with `build.manifest` on; the numbers are in that app's package.json:
//   "bundleBudget": { "firstScreenKiB": 110, "screens": ["src/features/member/HomeScreen.tsx"] }
// Sizes are brotli at quality 9, which matches what Cloudflare Pages sends within a few percent (2026-10-25).
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { checkBudget, firstScreenFiles } from "./lib/bundle-budget.mjs";

const app = process.cwd();
const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const { firstScreenKiB, screens } = pkg.bundleBudget;
const dist = join(app, "dist");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));
// The manifest is only for this check; it isn't deployed.
rmSync(join(dist, ".vite"), { recursive: true, force: true });

const sizeOf = (file) =>
  brotliCompressSync(readFileSync(join(dist, file)), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
const result = checkBudget(firstScreenFiles(manifest, screens), sizeOf, firstScreenKiB);

const line = `${pkg.name}: first screen JS ${result.totalKiB.toFixed(1)} KiB br of ${firstScreenKiB} KiB`;
if (result.ok) {
  console.log(`${line}: ok`);
} else {
  console.error(`${line}: over budget. The biggest files:`);
  for (const f of result.files.slice(0, 8))
    console.error(`  ${(f.bytes / 1024).toFixed(1).padStart(6)} KiB  ${f.file}`);
  console.error(
    "Load the new code lazily (a route or a component), or raise the budget in package.json with a reason.",
  );
  process.exit(1);
}
