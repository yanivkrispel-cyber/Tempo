#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import developmentConfig from "../config/development";
import { pagesHeadersFile } from "../lib/web/pages-headers";

// Writes the Cloudflare Pages `_headers` file into each built app (ADR-0027). Used by the deploy workflow:
//   npx ts-node --prefer-ts-exts bin/pages-headers.ts <api url> <dist dir>...
const [apiUrl, ...distDirs] = process.argv.slice(2);
if (!apiUrl || distDirs.length === 0) {
  console.error("usage: pages-headers.ts <api url> <dist dir>...");
  process.exit(2);
}

const file = pagesHeadersFile(developmentConfig, apiUrl);
for (const dir of distDirs) {
  writeFileSync(`${dir}/_headers`, file);
  console.log(`wrote ${dir}/_headers`);
}
