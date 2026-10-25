// node --test tools/scripts/lib/perf-big.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { computePercent, pickBranch, STOP_PERCENT } from "./perf-big.mjs";

const BRANCHES = [
  { id: "br-main", name: "production", default: true },
  { id: "br-big", name: "perf-big-2026-10-25", default: false },
];

test("--branch is required and must start with perf-big-", () => {
  assert.throws(() => pickBranch(BRANCHES, undefined), /--branch is required/);
  assert.throws(() => pickBranch(BRANCHES, "dev-kris"), /must start with perf-big-/);
});

test("the dev main branch is refused by name, by id and by the default flag", () => {
  assert.throws(() => pickBranch(BRANCHES, "production"), /must start with perf-big-|main branch/);
  assert.throws(() => pickBranch(BRANCHES, "br-main"), /must start with perf-big-|main branch/);
  assert.throws(
    () => pickBranch([{ id: "br-x", name: "perf-big-oops", default: true }], "perf-big-oops"),
    /main branch/,
  );
});

test("an existing perf branch is found; a missing one is reported as missing", () => {
  assert.equal(pickBranch(BRANCHES, "perf-big-2026-10-25").id, "br-big");
  assert.equal(pickBranch(BRANCHES, "perf-big-new"), null);
});

test("compute is a percent of the Free plan's 100 CU-hours, and the stop line is 35", () => {
  assert.equal(computePercent({ compute_time_seconds: 72_000 }), 20);
  assert.equal(STOP_PERCENT, 35);
});
