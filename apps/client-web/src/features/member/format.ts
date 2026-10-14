import { addDays, type IsoDate } from "../../shared/utilities/dates";

const weekdayLong = new Intl.DateTimeFormat("he-IL", { weekday: "long" });
const asDate = (iso: IsoDate) => new Date(`${iso}T00:00:00`);

/** "יום רביעי", "שבת": day names in full (brand book). */
export function dayName(iso: IsoDate): string {
  return weekdayLong.format(asDate(iso));
}

/** "רביעי", "שבת": the name without "יום", for tight places. */
export function shortDayName(iso: IsoDate): string {
  return dayName(iso).replace(/^יום\s+/, "");
}

/** "היום", "מחר", or the day's name. */
export function relativeDay(iso: IsoDate, today: IsoDate): string {
  if (iso === today) return "היום";
  if (iso === addDays(today, 1)) return "מחר";
  return dayName(iso);
}
