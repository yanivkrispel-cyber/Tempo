#!/usr/bin/env node
/**
 * Proves the public routes' rate limits on a deployed API (board #404, S-A, K4).
 *
 *   gateway: one burst of parallel anonymous reads of a public studio, more than the route's burst allows. API Gateway
 *            answers the excess with 429 before the function runs, so Neon and Lambda never see it.
 *
 * Usage: node tools/scripts/public-limits-check.mjs [--api-url <url>] [--slug test-studio-1] [--requests 70]
 * Prints counts per status only: no tokens, no bodies.
 */
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const api = option("--api-url", "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com");
const slug = option("--slug", "test-studio-1");
const requests = Number(option("--requests", "70"));

async function burst(label, url, count) {
  const started = Date.now();
  const statuses = await Promise.all(
    Array.from({ length: count }, () =>
      fetch(url)
        .then(async (response) => {
          await response.arrayBuffer();
          return response.status;
        })
        .catch(() => "network"),
    ),
  );
  const counts = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([status, n]) => `${status}×${n}`)
    .join(" ");
  console.log(`${label}: ${count} parallel requests in ${Date.now() - started} ms → ${summary}`);
  return counts;
}

const route = await burst(
  `gateway GET /public/studios/${slug}/manifest.webmanifest`,
  `${api}/api/v1/public/studios/${slug}/manifest.webmanifest`,
  requests,
);
const limited = route[429] ?? 0;
if (limited === 0) {
  console.log("✗ no 429: the route's throttle did not show (is the stage's route setting deployed?)");
  process.exitCode = 1;
} else {
  console.log(`✓ the gateway refused ${limited} of ${requests} with 429`);
}

// A plain authenticated-route read in the same second still answers: the public throttle is its own bucket.
const health = await fetch(`${api}/api/v1/health`);
console.log(`${health.status === 200 ? "✓" : "✗"} GET /api/v1/health right after → ${health.status}`);
if (health.status !== 200) process.exitCode = 1;
