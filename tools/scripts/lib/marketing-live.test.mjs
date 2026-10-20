// node --test tools/scripts/lib/marketing-live.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

import { ringPng, studioLocal } from "./marketing-live.mjs";
import { pngSize } from "./pwa-manifest.mjs";

test("ringPng draws a ring on a transparent ground at the size asked", () => {
  const png = ringPng(64, [0x4a, 0x70, 0x88]);
  assert.deepEqual(pngSize(png), { width: 64, height: 64 });
  const idat = png.indexOf(Buffer.from("IDAT"));
  const length = png.readUInt32BE(idat - 4);
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
  const pixel = (x, y) => raw.subarray(y * (1 + 64 * 4) + 1 + x * 4, y * (1 + 64 * 4) + 1 + x * 4 + 4);
  assert.deepEqual([...pixel(32, 32)], [0, 0, 0, 0], "the centre is empty");
  assert.deepEqual([...pixel(0, 0)], [0, 0, 0, 0], "the corner is empty");
  assert.deepEqual([...pixel(32, 8)], [0x4a, 0x70, 0x88, 255], "the ring is drawn");
});

test("studioLocal gives the studio's date and time", () => {
  assert.deepEqual(studioLocal(new Date("2026-10-19T21:30:00Z")), { localDate: "2026-10-20", localStart: "00:30" });
});
