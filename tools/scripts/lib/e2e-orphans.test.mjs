// node --test tools/scripts/lib/e2e-orphans.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { findOrphans, summarizeOrphans } from "./e2e-orphans.mjs";

const row = (email, subjects, extra = {}) => ({ id: `id-${email}`, email, subjects, liveMemberships: 0, nonE2eMemberships: 0, ...extra });

test("an e2e account row is orphaned when none of its Cognito subjects is a live user (#312, Q-3)", () => {
  const live = new Set(["sub-live"]);
  const rows = [
    row("e2e-p2-owner-1a@example.com", ["sub-gone"]),
    row("e2e-p2-owner-2b@example.com", ["sub-live"]),
    row("e2e-sync6-owner-3c@example.com", []),
    row("e2e-sync6-owner-4d@example.com", ["sub-gone", "sub-live"]),
  ];
  assert.deepEqual(
    findOrphans(rows, live).map((r) => r.email),
    ["e2e-p2-owner-1a@example.com", "e2e-sync6-owner-3c@example.com"],
  );
});

test("the same address with a new Cognito user still leaves the old row orphaned: matched by subject, not email", () => {
  const rows = [row("e2e-o4-o1m-x@example.com", ["sub-old"]), row("e2e-o4-o1m-x@example.com", ["sub-new"])];
  assert.deepEqual(
    findOrphans(rows, new Set(["sub-new"])).map((r) => r.subjects),
    [["sub-old"]],
  );
});

test("rows that are not e2e logins are never listed, even with no live user", () => {
  const rows = [
    row("kris@example.com", ["sub-gone"]),
    row("demo-member-01@example.com", []),
    row("e2e-owner@example.org", []),
    row("xe2e-owner@example.com", []),
    row(null, []),
  ];
  assert.deepEqual(findOrphans(rows, new Set()), []);
});

test("the summary counts orphans by run and flags any that still hold a live place outside e2e studios", () => {
  const orphans = [
    row("e2e-p2-owner-mvc0cvas@example.com", ["a"], { liveMemberships: 1 }),
    row("e2e-p2-member-mvc0cvas@example.com", ["b"]),
    row("e2e-sync6-owner-mvcet0a1@example.com", ["c"], { liveMemberships: 1 }),
    row("e2e-health-6fe5c1d2@example.com", ["d"], { liveMemberships: 2, nonE2eMemberships: 1 }),
  ];
  const summary = summarizeOrphans(orphans);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.byRun, [
    ["e2e-p2", 2],
    ["e2e-health", 1],
    ["e2e-sync6", 1],
  ]);
  assert.equal(summary.withLiveMemberships, 3);
  assert.deepEqual(
    summary.outsideE2e.map((r) => r.email),
    ["e2e-health-6fe5c1d2@example.com"],
  );
});
