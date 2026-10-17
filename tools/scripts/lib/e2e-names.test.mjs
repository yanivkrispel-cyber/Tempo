// node --test tools/scripts/lib/e2e-names.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { isE2eEmail, isE2eStudio } from "./e2e-names.mjs";

test("the cleanup matches e2e logins only", () => {
  for (const email of ["e2e-p2-owner-1a2b@example.com", "e2e-health-9f8e7d6c5b@example.com", " E2E-sync6-member@EXAMPLE.com "]) {
    assert.equal(isE2eEmail(email), true, email);
  }
  for (const email of [
    "kris@example.com",
    "demo-member-01@example.com",
    "smoke@example.com",
    "e2e@example.com",
    "e2e-owner@example.org",
    "e2e-owner@example.com.evil.test",
    "xe2e-owner@example.com",
    "owner-e2e-1@example.com",
    "e2e-owner+tag@example.com",
    "e2e-owner@sub.example.com",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isE2eEmail(email), false, String(email));
  }
});

test("the cleanup matches e2e studios only, by slug", () => {
  assert.equal(isE2eStudio({ slug: "e2e-p2-3c4d", displayName: "סטודיו בדיקה" }), true);
  assert.equal(isE2eStudio({ slug: "e2e-sync6-1a2b" }), true);
  for (const studio of [
    { slug: "smoke-studio", displayName: "e2e-looks-like-one" },
    { slug: "demo-studio" },
    { slug: "studio-e2e-1" },
    { slug: "e2e" },
    { slug: "e2e-" },
    { slug: "E2E-UPPER" },
    { displayName: "e2e-no-slug" },
    null,
  ]) {
    assert.equal(isE2eStudio(studio), false, JSON.stringify(studio));
  }
});
