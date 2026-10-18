#!/usr/bin/env node
/**
 * The install gate (board #347, K2): checks that each deployed web app can be installed from Chrome on Android.
 * The rules are in `lib/pwa-manifest.mjs`: name, id, start_url inside the scope, an installing display, PNG icons of
 * 192 and 512 for purpose any and a maskable one, each answering 200 image/png at its declared size.
 *
 * Usage:
 *   node tools/scripts/pwa-check.mjs https://tempo-members.pages.dev https://tempo-studio-console.pages.dev
 *
 * Exits 1 when any app has a problem. Reads only public pages; no credentials.
 */

import { checkApp } from "./lib/pwa-manifest.mjs";

const apps = process.argv.slice(2);
if (apps.length === 0) {
  console.error("usage: node tools/scripts/pwa-check.mjs <app url> [<app url> ...]");
  process.exit(2);
}

let failed = false;
for (const app of apps) {
  const url = new URL(app.endsWith("/") ? app : `${app}/`).href;
  let problems;
  try {
    problems = await checkApp(url);
  } catch (error) {
    problems = [`could not be checked: ${error.message}`];
  }
  if (problems.length === 0) {
    console.log(`ok ${url} is installable`);
    continue;
  }
  failed = true;
  for (const problem of problems) console.log(`::error::${url}: ${problem}`);
}
process.exit(failed ? 1 : 0);
