import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  parseCsv,
  proposeMapping,
  readImportBytes,
  readImportFile,
  toImportRows,
  type ReadResult,
} from "./csv";

// Every name, email and phone here is made up (public repo, board #321): Hebrew test names, @example.com emails and
// 050-00000xx numbers, which the reader passes through untouched (the API judges them).

const utf8 = (text: string) => new TextEncoder().encode(text);
const BOM = [0xef, 0xbb, 0xbf];

/** Windows-1255 bytes for ASCII and the Hebrew letters (א to ת are 0xE0 to 0xFA), as Excel writes on a Hebrew Windows. */
function windows1255(text: string): Uint8Array {
  return Uint8Array.from([...text], (char) => {
    const code = char.codePointAt(0)!;
    if (code < 0x80) return code;
    if (code >= 0x5d0 && code <= 0x5ea) return 0xe0 + (code - 0x5d0);
    throw new Error(`This helper has no Windows-1255 byte for ${char}`);
  });
}

function read(bytes: Uint8Array): Extract<ReadResult, { ok: true }>["file"] {
  const result = readImportBytes(bytes);
  if (!result.ok) throw new Error(`Expected the file to read, got ${result.reason}`);
  return result.file;
}

describe("reading the file's bytes", () => {
  it("reads a Windows-1255 file, as Excel saves a CSV on a Hebrew Windows", () => {
    const file = read(windows1255("שם מלא,טלפון,אימייל\r\nמאיה דמו,050-0000001,maya@example.com\r\n"));
    expect(file.encoding).toBe("windows-1255");
    expect(file.header.cells).toEqual(["שם מלא", "טלפון", "אימייל"]);
    expect(file.rows).toEqual([{ line: 2, cells: ["מאיה דמו", "050-0000001", "maya@example.com"] }]);
  });

  it("reads UTF-8 with a BOM, and the BOM doesn't stick to the first column's name", () => {
    const file = read(Uint8Array.from([...BOM, ...utf8("שם,מייל\nרון ניסיון,ron@example.com\n")]));
    expect(file.encoding).toBe("utf-8");
    expect(file.header.cells[0]).toBe("שם");
    expect(proposeMapping(file.header.cells)).toEqual({ displayName: 0, email: 1 });
  });

  it("reads UTF-8 without a BOM", () => {
    const file = read(utf8("שם,מייל\nרון ניסיון,ron@example.com"));
    expect(file.encoding).toBe("utf-8");
    expect(file.rows).toEqual([{ line: 2, cells: ["רון ניסיון", "ron@example.com"] }]);
  });

  it("refuses a file over 2 MB before reading it", async () => {
    const result = await readImportFile(new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]));
    expect(result).toEqual({ ok: false, reason: "too_big", bytes: MAX_FILE_BYTES + 1 });
  });

  it("reads a file picked on the device", async () => {
    const result = await readImportFile(
      new Blob([utf8("שם,מייל\nדנה ניסוי,dana@example.com\n")], { type: "text/csv" }),
    );
    expect(result.ok && result.file.rows).toEqual([{ line: 2, cells: ["דנה ניסוי", "dana@example.com"] }]);
  });

  it("refuses an Excel workbook and Unicode Text, so the screen can say how to save as CSV", () => {
    expect(readImportBytes(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14]))).toEqual({
      ok: false,
      reason: "spreadsheet",
    });
    expect(readImportBytes(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toEqual({
      ok: false,
      reason: "spreadsheet",
    });
    expect(readImportBytes(Uint8Array.from([0xff, 0xfe, 0xe9, 0x05]))).toEqual({ ok: false, reason: "unicode_text" });
  });

  it("says a file with no row after the header is empty", () => {
    expect(readImportBytes(utf8("שם,מייל\n"))).toEqual({ ok: false, reason: "empty" });
    expect(readImportBytes(utf8("\n\n,,\n"))).toEqual({ ok: false, reason: "empty" });
    expect(readImportBytes(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });

  it("takes 1,000 rows and refuses 1,001 with the count, so the screen can ask to split the file", () => {
    const file = (rows: number) =>
      utf8(["שם,מייל", ...Array.from({ length: rows }, (_, i) => `ניסוי ${i},e2e-${i}@example.com`)].join("\n"));
    expect(read(file(MAX_ROWS)).rows).toHaveLength(MAX_ROWS);
    expect(readImportBytes(file(MAX_ROWS + 1))).toEqual({ ok: false, reason: "too_many_rows", rows: MAX_ROWS + 1 });
  });
});

describe("splitting rows and cells", () => {
  it("keeps a quoted comma, a doubled quote and a line break inside quotes in one cell (RFC 4180)", () => {
    const { rows } = parseCsv('שם,הערה\n"ניסיון, רון","אולפן ""בית"" שורה\nשנייה"\nמאיה דמו,אחת\n');
    expect(rows).toEqual([
      { line: 1, cells: ["שם", "הערה"] },
      { line: 2, cells: ["ניסיון, רון", 'אולפן "בית" שורה\nשנייה'] },
      // The line break inside quotes stays in row 2, so this is row 3, as the spreadsheet numbers it.
      { line: 3, cells: ["מאיה דמו", "אחת"] },
    ]);
  });

  it('keeps a quote inside an unquoted cell as a character (דוא"ל)', () => {
    expect(parseCsv('שם,דוא"ל\n').rows[0]!.cells).toEqual(["שם", 'דוא"ל']);
    expect(parseCsv('שם,"דוא""ל"\n').rows[0]!.cells).toEqual(["שם", 'דוא"ל']);
  });

  it("skips empty rows but still counts them, so every line matches the spreadsheet's row", () => {
    const file = read(utf8("שם,מייל\n\nאורי ניסוי,ori@example.com\n,,\nטל ניסוי,tal@example.com\n"));
    expect(file.rows.map((row) => row.line)).toEqual([3, 5]);
  });

  it("ignores Excel's trailing separators on the header, on each row and on an empty row", () => {
    const file = read(utf8("שם,טלפון,,,\r\nמאיה דמו,050-0000001,,,\r\n,,,,\r\n"));
    const mapping = proposeMapping(file.header.cells);
    expect(mapping).toEqual({ displayName: 0, phone: 1 });
    expect(toImportRows(file.rows, mapping)).toEqual([{ line: 2, displayName: "מאיה דמו", phone: "050-0000001" }]);
  });

  it("finds a semicolon or a tab separator", () => {
    expect(parseCsv("שם;טלפון;מייל\nא;1;a@example.com\n").separator).toBe(";");
    expect(parseCsv("שם\tטלפון\nא\t1\n").separator).toBe("\t");
    expect(parseCsv("שם,טלפון\nא,1\n").separator).toBe(",");
  });

  it("prefers the separator that splits the header into known column names", () => {
    // A comma inside a semicolon file's column name: both split the header in two, but only ; gives known names.
    const { separator, rows } = parseCsv("שם, מלא;טלפון\nמאיה דמו;050-0000001\n");
    expect(separator).toBe(";");
    expect(rows[0]!.cells).toEqual(["שם, מלא", "טלפון"]);
  });

  it("follows Excel's sep= line and leaves it out of the rows", () => {
    const { separator, rows } = parseCsv("sep=;\r\nשם;מייל\r\nא;a@example.com\r\n");
    expect(separator).toBe(";");
    expect(rows[0]).toEqual({ line: 1, cells: ["שם", "מייל"] });
  });

  it("reads CRLF, LF and a lone CR as the end of a row", () => {
    expect(parseCsv("שם\r\nא\rב\nג").rows.map((row) => row.cells[0])).toEqual(["שם", "א", "ב", "ג"]);
  });
});

describe("proposing a column for each field", () => {
  it("knows the Hebrew column names", () => {
    expect(proposeMapping(["שם מלא", "נייד", 'דוא"ל', "תאריך לידה"])).toEqual({
      displayName: 0,
      phone: 1,
      email: 2,
      birthDate: 3,
    });
    expect(proposeMapping(["שם פרטי", "שם משפחה", "פלאפון", "מייל"])).toEqual({
      givenName: 0,
      familyName: 1,
      phone: 2,
      email: 3,
    });
    expect(proposeMapping(["שם", "טלפון", "דוא״ל", "אימייל"])).toEqual({ displayName: 0, phone: 1, email: 2 });
  });

  it("knows the English column names, whatever their case or punctuation", () => {
    expect(proposeMapping(["First Name", "Last Name", "E-mail", "Mobile", "Date of Birth"])).toEqual({
      givenName: 0,
      familyName: 1,
      email: 2,
      phone: 3,
      birthDate: 4,
    });
    expect(proposeMapping(["full_name", "PHONE", "email address"])).toEqual({ displayName: 0, phone: 1, email: 2 });
  });

  it("leaves unknown columns out, and gives each field its first column", () => {
    expect(proposeMapping(["שם", "הערות", "טלפון", "טלפון נוסף", "טלפון"])).toEqual({ displayName: 0, phone: 2 });
  });
});

describe("the rows the API takes", () => {
  it("sends each mapped cell trimmed, leaves an empty one out and keeps the row's line", () => {
    const rows = [
      { line: 2, cells: [" מאיה ", "", "maya@example.com ", "ignored"] },
      { line: 4, cells: ["", "050-0000002", "", ""] },
    ];
    expect(toImportRows(rows, { displayName: 0, phone: 1, email: 2 })).toEqual([
      { line: 2, displayName: "מאיה", email: "maya@example.com" },
      { line: 4, phone: "050-0000002" },
    ]);
  });

  it("sends given and family names apart, for the API to join", () => {
    const file = read(utf8("שם פרטי,שם משפחה,טלפון,תאריך לידה\nמאיה,דמו,050-0000001,01/05/1990\n"));
    expect(toImportRows(file.rows, proposeMapping(file.header.cells))).toEqual([
      { line: 2, givenName: "מאיה", familyName: "דמו", phone: "050-0000001", birthDate: "01/05/1990" },
    ]);
  });
});
