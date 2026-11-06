// node --test tools/scripts/lib/pilot-pulse.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULSE_COLUMNS, PULSE_SQL, formatPulse } from "./pilot-pulse.mjs";

test("the pulse reads counts and dates only: no personal column is selected", () => {
  const select = PULSE_SQL.toLowerCase();
  for (const personal of ["email", "phone", "display_name", "given_name", "family_name", "birth_date", "note", "body", "value"]) {
    assert.equal(new RegExp(`\\b[a-z]+\\.${personal}\\b`).test(select), false, personal);
  }
  for (const column of PULSE_COLUMNS) assert.match(PULSE_SQL, new RegExp(`\\b${column}\\b`), column);
});

test("the pulse only reads", () => {
  assert.doesNotMatch(PULSE_SQL, /\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i);
});

test("a row becomes one table line, in column order, with a dash for nothing and extra fields dropped", () => {
  const text = formatPulse(
    [
      {
        slug: "studio-a",
        status: "active",
        created_on: "2026-11-01",
        members: 12,
        staff: 2,
        people: 30,
        weekly_classes: 8,
        sessions_next_7: 8,
        bookings_7: 40,
        bookings_28: 120,
        attended_7: 35,
        attended_28: 100,
        passes_active: 25,
        last_staff_sign_in: null,
        email: "someone@example.com",
      },
    ],
    new Date("2026-11-03T09:00:00Z"),
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "Pilot pulse, 2026-11-03 09:00Z, 1 studio");
  assert.equal(lines[4], "| studio-a | active | 2026-11-01 | 12 | 2 | 30 | 8 | 8 | 40 | 120 | 35 | 100 | 25 | — |");
  assert.doesNotMatch(text, /example\.com/);
});
