// node --test tools/scripts/lib/premium-live.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, inflateSync } from "node:zlib";

import { s3ErrorCode, solidPng, uploadFormData } from "./premium-live.mjs";

test("solidPng is a real PNG: signature, IHDR of the right size, valid CRCs, pixels that inflate", () => {
  const png = solidPng(4, 3, [0x56, 0x73, 0x5b]);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)) >>> 0, `${type} CRC`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  assert.equal(chunks[0].data.readUInt32BE(0), 4);
  assert.equal(chunks[0].data.readUInt32BE(4), 3);
  const raw = inflateSync(chunks[1].data);
  assert.equal(raw.length, 3 * (1 + 4 * 3));
  assert.deepEqual([...raw.subarray(0, 4)], [0, 0x56, 0x73, 0x5b]);
});

test("uploadFormData sends every field in order, then the file last as `file`", async () => {
  const form = uploadFormData({ key: "incoming/x", "Content-Type": "image/png", Policy: "p" }, Buffer.from("abc"), "image/png");
  const entries = [...form.entries()];
  assert.deepEqual(entries.slice(0, 3), [
    ["key", "incoming/x"],
    ["Content-Type", "image/png"],
    ["Policy", "p"],
  ]);
  assert.equal(entries[3][0], "file");
  assert.equal(await entries[3][1].text(), "abc");
});

test("s3ErrorCode reads the Code of S3's XML error, or null", () => {
  assert.equal(s3ErrorCode("<?xml version='1.0'?><Error><Code>EntityTooLarge</Code><Message>x</Message></Error>"), "EntityTooLarge");
  assert.equal(s3ErrorCode(""), null);
});
