#!/usr/bin/env node
/**
 * The install gate (board #347, K2): checks that each deployed web app can be installed from Chrome on Android.
 * The rules are in `lib/pwa-manifest.mjs`: name, id, start_url inside the scope, an installing display, PNG icons of
 * 192 and 512 for purpose any and a maskable one, each answering 200 image/png at its declared size.
 *
 * Usage:
 *   node tools/scripts/pwa-check.mjs https://tempo-members.pages.dev https://tempo-studio-console.pages.dev
 *
 * One studio's own app (docs/35 W-6, board #380 K2): its manifest comes from the API, with CORS for the members app,
 * and its id, start_url and scope are absolute at `<members app>/s/<slug>/`:
 *   node tools/scripts/pwa-check.mjs --studio test-studio-1 --api https://<api> https://tempo-members.pages.dev
 *
 * Exits 1 when any app has a problem. Reads only public pages; no credentials.
 */

import { checkApp, checkStudio } from "./lib/pwa-manifest.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const [, value] = args.splice(index, 2);
  return value ?? null;
};
const studio = option("--studio");
const api = option("--api");
const apps = args;
if (apps.length === 0 || (studio && (!api || apps.length !== 1))) {
  console.error("usage: node tools/scripts/pwa-check.mjs <app url> [<app url> ...]");
  console.error("       node tools/scripts/pwa-check.mjs --studio <slug> --api <api url> <members app url>");
  process.exit(2);
}

let failed = false;
for (const app of apps) {
  const url = new URL(app.endsWith("/") ? app : `${app}/`).href;
  const label = studio ? `${url}s/${studio}/` : url;
  let problems;
  try {
    problems = studio ? await checkStudio(api, url, studio) : await checkApp(url);
  } catch (error) {
    problems = [`could not be checked: ${error.message}`];
  }
  if (problems.length === 0) {
    console.log(`ok ${label} is installable`);
    continue;
  }
  failed = true;
  for (const problem of problems) console.log(`::error::${label}: ${problem}`);
}
process.exit(failed ? 1 : 0);
