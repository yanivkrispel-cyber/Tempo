/**
 * Helpers for the premium live check (board #347, K4): a real picture without an image library, the presigned POST
 * form S3 expects, and S3's error code.
 */

import { crc32, deflateSync } from "node:zlib";

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG of one colour, width x height, 8-bit RGB: small, valid, and decodable by the API's image library. */
export function solidPng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The presigned POST's body: every field as given, in order, then the file last as `file` (docs/33 6.3). */
export function uploadFormData(fields, bytes, contentType) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", new Blob([bytes], { type: contentType }), "picture");
  return form;
}

/** The `<Code>` of an S3 XML error body, or null. */
export function s3ErrorCode(xml) {
  return /<Code>([^<]+)<\/Code>/.exec(xml ?? "")?.[1] ?? null;
}
