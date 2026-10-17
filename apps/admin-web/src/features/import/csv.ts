import type { Schemas } from "@tempo/api-client";

/**
 * The member import's file reader (docs/34 sections 2 and 4; day board #321, I-2 and I-3). The console reads the CSV
 * file in the browser and sends JSON rows, so the file never leaves the device. This module turns the file's bytes
 * into rows:
 * - it decodes UTF-8, with or without a BOM, or Windows-1255, which is what Excel's "CSV (Comma delimited)" writes on
 *   a Hebrew Windows;
 * - it finds the separator (comma, semicolon or tab) and reads RFC 4180 quotes;
 * - it proposes which column holds which field from the header row, in Hebrew or English;
 * - it keeps each row's number as a spreadsheet shows it, so a result can point at the row.
 *
 * It does not judge what a cell means (a name, a phone, a date): the API's dry run does, so the two never disagree.
 * No dependency: TextDecoder does the decoding.
 */

/** I-2: a bigger file is refused with a note to split it. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** I-2 and the API's limit (docs/34 section 4): rows after the header. */
export const MAX_ROWS = 1000;

export type ImportField = "displayName" | "givenName" | "familyName" | "phone" | "email" | "birthDate";

/** The fields in the order the screen lists them. */
export const IMPORT_FIELDS: readonly ImportField[] = [
  "displayName",
  "givenName",
  "familyName",
  "phone",
  "email",
  "birthDate",
];

export type Separator = "," | ";" | "\t";
export type Encoding = "utf-8" | "windows-1255";

/** One row of the file: its cells, and its number as a spreadsheet shows it (the header is usually row 1). */
export interface CsvRow {
  line: number;
  cells: string[];
}

/** Which column (by index) holds each field. A field with no column is left out. */
export type Mapping = Partial<Record<ImportField, number>>;

export interface CsvFile {
  encoding: Encoding;
  separator: Separator;
  /** The first row that has any text: the column names. */
  header: CsvRow;
  /** Every later row that has any text. Empty rows are skipped but still counted in `line`. */
  rows: CsvRow[];
}

export type ReadProblem =
  | { reason: "too_big"; bytes: number }
  | { reason: "too_many_rows"; rows: number }
  /** No row after the header. */
  | { reason: "empty" }
  /** An Excel or another spreadsheet file (.xlsx, .xls, .ods): it has to be saved as CSV first. */
  | { reason: "spreadsheet" }
  /** UTF-16, Excel's "Unicode Text": not one of the encodings I-2 reads. */
  | { reason: "unicode_text" };

export type ReadResult = { ok: true; file: CsvFile } | ({ ok: false } & ReadProblem);

/** Reads a file the person picked or dropped. The size is checked before a byte is read. */
export async function readImportFile(file: Blob): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "too_big", bytes: file.size };
  return readImportBytes(new Uint8Array(await file.arrayBuffer()));
}

export function readImportBytes(bytes: Uint8Array): ReadResult {
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, reason: "too_big", bytes: bytes.length };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]))
    return { ok: false, reason: "spreadsheet" };
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return { ok: false, reason: "unicode_text" };

  const { text, encoding } = decode(bytes);
  const { separator, rows } = parseCsv(text);
  const filled = rows.filter((row) => row.cells.some((cell) => cell !== ""));
  const [header, ...data] = filled;
  if (!header || data.length === 0) return { ok: false, reason: "empty" };
  if (data.length > MAX_ROWS) return { ok: false, reason: "too_many_rows", rows: data.length };
  return { ok: true, file: { encoding, separator, header, rows: data } };
}

/**
 * UTF-8 when the bytes are valid UTF-8 (a BOM is dropped), else Windows-1255. Hebrew in Windows-1255 is never valid
 * UTF-8: its letters are bytes from 0xE0 up, which in UTF-8 must be followed by bytes under 0xC0.
 */
export function decode(bytes: Uint8Array): { text: string; encoding: Encoding } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1255").decode(bytes), encoding: "windows-1255" };
  }
}

/**
 * Splits CSV text into rows of trimmed cells (RFC 4180: a quoted cell may hold the separator, a line break, and `""`
 * for a quote). The separator is Excel's `sep=` line when there is one, else the one that splits the first row into
 * the most column names the console knows, then into the most cells, with a comma on a tie. A row's `line` counts rows
 * as a spreadsheet does: a line break inside quotes stays in its row, and an empty row still takes a number.
 */
export function parseCsv(input: string): { separator: Separator; rows: CsvRow[] } {
  let text = input.replace(/^\uFEFF/, "");
  let separator: Separator | undefined;
  const directive = /^sep=(.)\r?\n/i.exec(text);
  if (directive && isSeparator(directive[1]!)) {
    separator = directive[1];
    text = text.slice(directive[0].length);
  }
  separator ??= guessSeparator(text);
  const rows = [...records(text, separator)].map((cells, index) => ({ line: index + 1, cells }));
  return { separator, rows };
}

/** The file's rows one at a time, each as its trimmed cells; an empty line is a row with one empty cell. */
function* records(text: string, separator: Separator): Generator<string[]> {
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let open = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
    } else if (char === '"' && cell.trim() === "") {
      // A quote opens a quoted cell only at the cell's start; elsewhere (דוא"ל) it is a character like any other.
      cell = "";
      quoted = true;
      open = true;
    } else if (char === separator) {
      cells.push(cell.trim());
      cell = "";
      open = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      cells.push(cell.trim());
      yield cells;
      cells = [];
      cell = "";
      open = false;
    } else {
      cell += char;
      open = true;
    }
  }
  if (open) {
    cells.push(cell.trim());
    yield cells;
  }
}

function guessSeparator(text: string): Separator {
  let best: Separator = ",";
  let bestScore = -1;
  for (const candidate of [",", ";", "\t"] as const) {
    let first: string[] = [];
    for (const cells of records(text, candidate)) {
      if (cells.some((cell) => cell !== "")) {
        first = cells;
        break;
      }
    }
    const known = first.filter((name) => fieldByKey.has(headerKey(name))).length;
    const score = known * 1000 + first.length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function isSeparator(char: string): char is Separator {
  return char === "," || char === ";" || char === "\t";
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** Column names the console recognises, in Hebrew and English (I-3), compared without spaces or punctuation. */
const HEADER_NAMES: Record<ImportField, string[]> = {
  displayName: ["שם", "שם מלא", "שם המתאמן", "שם מתאמן", "name", "full name", "display name"],
  givenName: ["שם פרטי", "first name", "given name"],
  familyName: ["שם משפחה", "last name", "family name", "surname"],
  phone: [
    "טלפון",
    "נייד",
    "פלאפון",
    "טלפון נייד",
    "מספר טלפון",
    "מספר נייד",
    "סלולרי",
    "phone",
    "mobile",
    "cell",
    "telephone",
    "tel",
    "phone number",
    "mobile phone",
  ],
  email: ["אימייל", 'דוא"ל', "מייל", "דואר אלקטרוני", "כתובת מייל", "email", "mail", "email address"],
  birthDate: ["תאריך לידה", "יום הולדת", "birth date", "date of birth", "birthday", "dob"],
};

/** A column name without case, spaces or punctuation: `דוא״ל` and `דוא"ל` match, as do `E-mail` and `email`. */
export function headerKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const fieldByKey = new Map<string, ImportField>(
  IMPORT_FIELDS.flatMap((field) => HEADER_NAMES[field].map((name) => [headerKey(name), field] as const)),
);

/** The proposed column for each field the header names; the first column wins, and a column serves one field. */
export function proposeMapping(header: string[]): Mapping {
  const mapping: Mapping = {};
  header.forEach((name, column) => {
    const field = fieldByKey.get(headerKey(name));
    if (field && mapping[field] === undefined) mapping[field] = column;
  });
  return mapping;
}

/** The rows as the API takes them (docs/34 section 4): each mapped cell trimmed, an empty one left out. */
export function toImportRows(rows: CsvRow[], mapping: Mapping): Schemas["ImportRow"][] {
  return rows.map(({ line, cells }) => {
    const row: Schemas["ImportRow"] = { line };
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field];
      const value = column === undefined ? "" : (cells[column] ?? "").trim();
      if (value !== "") row[field] = value;
    }
    return row;
  });
}
