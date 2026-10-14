/** A calendar date with no time zone, as the API sends it, e.g. "2026-10-15". */
export type IsoDate = string;

const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, "0");

/** The date at local midnight, or null when `iso` is not a real date ("2026-02-30"). */
export function fromIsoDate(iso: IsoDate): Date | null {
  const match = isoPattern.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function requireDate(iso: IsoDate): Date {
  const date = fromIsoDate(iso);
  if (!date) throw new RangeError(`Not a calendar date: "${iso}"`);
  return date;
}

export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

// Calendar arithmetic on local dates (setDate / setMonth), so a DST change never shifts a day.
export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = requireDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Same day of the month, or the month's last day when it is shorter: 31 Jan + 1 month = 28 Feb. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = requireDate(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

/** 0 is Sunday. */
export function dayOfWeek(iso: IsoDate): number {
  return requireDate(iso).getDay();
}

/** Weeks start on Sunday, as in Israel. */
export function startOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, -dayOfWeek(iso));
}

export function endOfWeek(iso: IsoDate): IsoDate {
  return addDays(startOfWeek(iso), 6);
}

export function startOfMonth(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 8)}01`;
}

export function sameMonth(a: IsoDate, b: IsoDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** ISO dates sort as strings, so the range check is a string comparison. */
export function inRange(iso: IsoDate, min?: IsoDate, max?: IsoDate): boolean {
  return (min === undefined || iso >= min) && (max === undefined || iso <= max);
}

export function clampDate(iso: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min !== undefined && iso < min) return min;
  if (max !== undefined && iso > max) return max;
  return iso;
}

/** The weeks that show `iso`'s month, Sunday first, padded with the neighbouring months' days. */
export function monthWeeks(iso: IsoDate): IsoDate[][] {
  const first = startOfMonth(iso);
  const weeks: IsoDate[][] = [];
  let sunday = startOfWeek(first);
  do {
    const start = sunday;
    weeks.push(Array.from({ length: 7 }, (_, offset) => addDays(start, offset)));
    sunday = addDays(sunday, 7);
  } while (sameMonth(sunday, first));
  return weeks;
}

/** "15.10.2026", the way dates are written in Israel. */
export function formatDate(iso: IsoDate): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/**
 * Reads a typed date, day first: "15.10.2026", "15/10/26", "5-3-2026", "151026", "15102026", or
 * "15.10" for this year. An ISO date is accepted as is. Returns null for anything else.
 *
 * A two-digit year is 20xx unless that is more than a year ahead, then 19xx ("15.10.85" is 1985,
 * "15.01.27" typed in October 2026 is next January). When `range` is given, the century that falls
 * inside it wins, so a birth date with max = today reads "15.10.30" as 1930.
 */
export function parseDate(text: string, today: IsoDate = todayIso(), range: { min?: IsoDate; max?: IsoDate } = {}): IsoDate | null {
  const value = text.trim();
  if (isoPattern.test(value)) return fromIsoDate(value) ? value : null;

  const match = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(value) ?? /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const day = pad(Number(match[1]));
  const month = pad(Number(match[2]));
  const typed = match[3];
  const thisYear = Number(today.slice(0, 4));

  let years: number[];
  if (typed === undefined) years = [thisYear];
  else if (typed.length === 4) years = [Number(typed)];
  else {
    const recent = 2000 + Number(typed);
    years = recent > thisYear + 1 ? [recent - 100, recent] : [recent, recent - 100];
  }

  const dates = years.map((year) => `${year}-${month}-${day}`).filter((iso) => fromIsoDate(iso) !== null);
  return dates.find((iso) => inRange(iso, range.min, range.max)) ?? dates[0] ?? null;
}
