/**
 * Helpers for the marketing live check (board #380, K6, MK6, MK9): a drawn mark for a demo studio's logo and icon
 * (never a real studio's, D-1), and the dates a check needs in the studio's time.
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

/**
 * A ring on a transparent ground, size x size, 8-bit RGBA: a simple drawn mark. The ring's outer edge is at 45% of
 * the side from the centre and its inner edge at 30%, so it stays inside a maskable icon's safe circle once the API
 * places it.
 */
export function ringPng(size, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const centre = (size - 1) / 2;
  const outer = size * 0.45;
  const inner = size * 0.3;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - centre, y - centre);
      if (distance <= outer && distance >= inner) row.set([r, g, b, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The studio's local date (`yyyy-mm-dd`) and time (`HH:mm`) of an instant, in Asia/Jerusalem. */
export function studioLocal(at) {
  return {
    localDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(at),
    localStart: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at),
  };
}
