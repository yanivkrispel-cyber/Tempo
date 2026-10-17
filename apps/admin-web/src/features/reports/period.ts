import { addDays, fromIsoDate, startOfWeek, type IsoDate } from "../../shared/utilities/dates";

/** docs/32 R-2: a report covers at most 92 days, both ends included. */
export const maxReportDays = 92;

export type PeriodPreset = "4" | "8" | "12" | "custom";

export interface Period {
  from: IsoDate;
  to: IsoDate;
}

/** The last `weeks` full Sunday-to-Saturday weeks before the one `today` is in (R-2's default is 4). */
export function lastFullWeeks(today: IsoDate, weeks: number): Period {
  const to = addDays(startOfWeek(today), -1);
  return { from: addDays(to, -(7 * weeks - 1)), to };
}

/** Days from `from` to `to`, both included. */
export function periodDays({ from, to }: Period): number {
  const start = fromIsoDate(from);
  const end = fromIsoDate(to);
  if (!start || !end) return Number.NaN;
  // Noon-to-noon in UTC, so a DST change never makes a day 23 or 25 hours long.
  const utc = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc(end) - utc(start)) / 86_400_000) + 1;
}

/** Why a typed period can't be asked for, in words; null when it can. */
export function periodProblem(from: IsoDate | null, to: IsoDate | null): string | null {
  if (!from || !to) return "בחרו תאריך התחלה ותאריך סיום.";
  if (to < from) return "תאריך הסיום לפני תאריך ההתחלה.";
  if (periodDays({ from, to }) > maxReportDays) return `דוח מכסה עד ${maxReportDays} ימים. קצרו את התקופה.`;
  return null;
}

/** "4.10" for a chart tick: day and month with no leading zeros. */
export function shortDay(iso: IsoDate): string {
  return `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
}
