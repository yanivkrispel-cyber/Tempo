#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pagesConfig, pagesHeadersFile } from "../lib/web/pages-headers";

// Writes the Cloudflare Pages `_headers` file into each built app (ADR-0027). Used by the deploy workflow:
//   npx ts-node --prefer-ts-exts bin/pages-headers.ts [--env=dev|stg|prod] <api url> <dist dir>...
// Without --env it is development, the only environment deployed today (#541 SR-37).
const args = process.argv.slice(2);
const envArg = args[0]?.startsWith("--env=") ? args.shift()?.slice("--env=".length) : undefined;
const [apiUrl, ...distDirs] = args;
if (!apiUrl || distDirs.length === 0) {
  console.error("usage: pages-headers.ts [--env=dev|stg|prod] <api url> <dist dir>...");
  process.exit(2);
}

const file = pagesHeadersFile(pagesConfig(envArg), apiUrl);
for (const dir of distDirs) {
  writeFileSync(`${dir}/_headers`, file);
  console.log(`wrote ${dir}/_headers`);
}
