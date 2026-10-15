// Times as the studio sees them: the API sends UTC instants, and every time a member reads is in the studio's own
// IANA time zone (docs/29 section 2), not the phone's.
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { relativeDay } from "./format";

/** The API's fallback when a studio has no zone (TimetableService.StudioZoneAsync). */
export const defaultTimeZone = "Asia/Jerusalem";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions, locale = "he-IL"): Intl.DateTimeFormat {
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

/** "17:30": the instant's time of day in the studio. */
export function clockTime(instant: string | Date, timeZone: string): string {
  const parts = formatter(`time|${timeZone}`, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** The instant's calendar date in the studio, e.g. "2026-10-13". */
export function studioDate(instant: string | Date, timeZone: string): IsoDate {
  // en-CA writes dates as YYYY-MM-DD.
  return formatter(`date|${timeZone}`, { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA").format(
    new Date(instant),
  );
}

/** Today in the studio. */
export function studioToday(timeZone: string, now: Date = new Date()): IsoDate {
  return studioDate(now, timeZone);
}

/** Whole minutes between two instants. */
export function minutesBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}

/** "היום 13:30", "מחר 09:00", "יום חמישי 15.10 18:00": a moment near today, for deadlines. */
export function momentText(instant: string | Date, timeZone: string, today: IsoDate): string {
  const date = studioDate(instant, timeZone);
  const time = clockTime(instant, timeZone);
  const near = date === today || date === addDays(today, 1);
  return near
    ? `${relativeDay(date, today)} ${time}`
    : `${relativeDay(date, today)} ${date.slice(8, 10)}.${date.slice(5, 7)} ${time}`;
}

export function hasStarted(startsAt: string, now: Date = new Date()): boolean {
  return new Date(startsAt).getTime() <= now.getTime();
}
