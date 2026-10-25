// node --test tools/scripts/lib/demo-fill.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { isFictional, planFill } from "./demo-fill.mjs";

const now = "2026-10-25T06:00:00Z";
const session = (id, startsAt, capacity, extra = {}) => ({
  id,
  startsAt,
  capacity,
  bookedCount: 0,
  waitlistCount: 0,
  status: "scheduled",
  ...extra,
});
const people = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);

test("only reserved example addresses count as fictional, so a real person is never booked", () => {
  assert.equal(isFictional({ primaryEmail: "demo-member-03@example.com" }), true);
  assert.equal(isFictional({ primaryEmail: "Someone@EXAMPLE.COM" }), true);
  assert.equal(isFictional({ primaryEmail: "someone@example.com.evil.test" }), false);
  assert.equal(isFictional({ primaryEmail: "someone@gmail.com" }), false);
  assert.equal(isFictional({ primaryEmail: null }), false);
  assert.equal(isFictional({}), false);
});

test("the smallest upcoming class fills to capacity with two waiting, the others about two thirds", () => {
  const sessions = [
    session("mat", "2026-10-25T15:00:00Z", 12),
    session("reformer", "2026-10-26T05:00:00Z", 4),
    session("yoga", "2026-10-27T06:00:00Z", 6),
  ];
  const plan = planFill(sessions, people, now);
  const byId = Object.fromEntries(plan.map((p) => [p.sessionId, p.personIds]));
  assert.equal(byId.reformer.length, 6); // 4 places and 2 waiting
  assert.equal(byId.mat.length, 8); // ceil(12 * 2/3)
  assert.equal(byId.yoga.length, 4);
  for (const ids of Object.values(byId)) assert.equal(new Set(ids).size, ids.length);
});

test("past, cancelled and already busy classes are left alone", () => {
  const sessions = [
    session("past", "2026-10-25T05:00:00Z", 10),
    session("cancelled", "2026-10-26T05:00:00Z", 10, { status: "cancelled" }),
    session("busy", "2026-10-26T07:00:00Z", 10, { bookedCount: 7 }),
    session("open", "2026-10-26T09:00:00Z", 10),
  ];
  const plan = planFill(sessions, people, now);
  assert.deepEqual(
    plan.map((p) => p.sessionId),
    ["open"],
  );
});

test("a class never gets more people than there are, and no one twice", () => {
  const plan = planFill([session("big", "2026-10-26T05:00:00Z", 30)], people.slice(0, 3), now);
  assert.deepEqual(plan, [{ sessionId: "big", personIds: ["p1", "p2", "p3"] }]);
});

test("the people rotate across classes, so each has a few bookings in the week", () => {
  const sessions = Array.from({ length: 6 }, (_, i) => session(`s${i}`, `2026-10-2${6 + (i % 3)}T0${i}:00:00Z`, 6));
  const counts = {};
  for (const { personIds } of planFill(sessions, people, now)) for (const id of personIds) counts[id] = (counts[id] ?? 0) + 1;
  assert.equal(Object.keys(counts).length, people.length);
  assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1);
});

test("nothing to do without people", () => {
  assert.deepEqual(planFill([session("a", "2026-10-26T05:00:00Z", 4)], [], now), []);
});
