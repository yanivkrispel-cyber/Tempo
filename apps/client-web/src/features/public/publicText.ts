import type { ChipTone } from "../../shared/design-system";
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { shortDayName } from "../member/format";
import { clockTime, hasStarted, studioDate } from "../member/studioTime";
import type { PublicProduct, PublicSession } from "./publicStudio";

/** The intro offer as one line: "שיעור ניסיון · 45 ₪", or its name alone when it has no price. */
export function offerText({ name, priceAgorot }: { name: string; priceAgorot: number | null }): string {
  return priceAgorot === null ? name : `${name} · ${priceText(priceAgorot)}`;
}

/** "היום", "מחר", or the day's short name ("שלישי"), for a class near today. */
export function dayWord(date: IsoDate, today: IsoDate): string {
  if (date === today) return "היום";
  if (date === addDays(today, 1)) return "מחר";
  return shortDayName(date);
}

/** "שלישי 21.10, בין 18:30 ל-19:20" (board א). */
export function dateLine(session: PublicSession, timeZone: string, today: IsoDate): string {
  const date = studioDate(session.startsAt, timeZone);
  const ends = new Date(Date.parse(session.startsAt) + session.minutes * 60_000);
  return `${dayWord(date, today)} ${date.slice(8, 10)}.${date.slice(5, 7)}, בין ${clockTime(session.startsAt, timeZone)} ל-${clockTime(ends, timeZone)}`;
}

/** "שלישי 18:30": a class named in one breath, in a title or on a button (board ז). */
export function shortWhen(session: PublicSession, timeZone: string, today: IsoDate): string {
  return `${dayWord(studioDate(session.startsAt, timeZone), today)} ${clockTime(session.startsAt, timeZone)}`;
}

/** "חמישי 23.10 · מאיה לוי": an alternative's day and teacher, under its name. */
export function slotMeta(session: PublicSession, timeZone: string, today: IsoDate): string {
  const date = studioDate(session.startsAt, timeZone);
  return [`${dayWord(date, today)} ${date.slice(8, 10)}.${date.slice(5, 7)}`, session.instructor?.displayName]
    .filter(Boolean)
    .join(" · ");
}

/** What a visitor can do with a class now (SL-3): book, join the waitlist, or look at another class. */
export type PublicClassState = "open" | "waitlist" | "full" | "cancelled" | "past";

export function publicState(session: PublicSession, now: Date): PublicClassState {
  if (session.availability === "cancelled") return "cancelled";
  if (hasStarted(session.startsAt, now)) return "past";
  if (session.availability === "full") return session.waitlistOpen ? "waitlist" : "full";
  return "open";
}

/**
 * The chip a class shows on its page, or in a list row (`short`, so the class's name keeps the room on a phone);
 * none while it has room.
 */
export function availabilityChip(
  session: PublicSession,
  now: Date,
  short = false,
): { label: string; tone: ChipTone } | null {
  switch (publicState(session, now)) {
    case "cancelled":
      return { label: short ? "בוטל" : "השיעור בוטל", tone: "neutral" };
    case "past":
      return { label: short ? "התקיים" : "השיעור כבר התקיים", tone: "neutral" };
    case "full":
      return { label: "מלא", tone: "neutral" };
    case "waitlist":
      return { label: short ? "המתנה" : "מלא · יש רשימת המתנה", tone: "warning" };
    default:
  }
  if (session.availability !== "few") return null;
  const left = session.spotsLeft ?? 3;
  if (short) return { label: left === 1 ? "מקום אחרון" : `${left} מקומות`, tone: "warning" };
  return { label: left === 1 ? "נשאר מקום אחד" : `נשארו ${left} מקומות`, tone: "warning" };
}

/** The chip of a class a visitor can no longer book (board ז). */
export function closedChip(state: PublicClassState): { label: string; tone: ChipTone } | null {
  switch (state) {
    case "full":
    case "waitlist":
      return { label: "השיעור התמלא", tone: "cat-rose" };
    case "cancelled":
      return { label: "השיעור בוטל", tone: "neutral" };
    case "past":
      return { label: "השיעור כבר התקיים", tone: "neutral" };
    default:
      return null;
  }
}

/** An alternative's chip: how many places are left when few are, else that it has room (board ז). */
export function roomChip(session: PublicSession): { label: string; tone: ChipTone } {
  if (session.availability !== "few") return { label: "יש מקום", tone: "brand" };
  const left = session.spotsLeft ?? 3;
  return { label: left === 1 ? "מקום אחרון" : `נשארו ${left}`, tone: "warning" };
}

/**
 * Up to three classes with room instead of one that is full, cancelled, over or gone (SL-3): the same kind of class
 * first, then any, soonest first.
 */
export function alternatives(sessions: readonly PublicSession[], instead: PublicSession | null, now: Date) {
  const same = (session: PublicSession) => Number(session.classType.name === instead?.classType.name);
  return sessions
    .filter((session) => session.id !== instead?.id && publicState(session, now) === "open")
    .sort((a, b) => same(b) - same(a) || Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 3);
}

/** "1,300 ₪", or "45.50 ₪": a price on the prices and offer pages (SL-4, SL-5). */
export function priceText(agorot: number): string {
  const amount = agorot / 100;
  return `${amount.toLocaleString("he-IL", { minimumFractionDigits: agorot % 100 ? 2 : 0, maximumFractionDigits: 2 })} ₪`;
}

/** "5 שבועות", "6 חודשים", "שנה": how long a pass lasts, in the words a person would use. */
export function validityText(days: number): string {
  if (days >= 360 && days <= 366) return "שנה";
  if (days >= 28 && days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "חודש" : months === 2 ? "חודשיים" : `${months} חודשים`;
  }
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "שבוע" : weeks === 2 ? "שבועיים" : `${weeks} שבועות`;
  }
  return days === 1 ? "יום" : `${days} ימים`;
}

/**
 * "70 ₪ לשיעור, תוך 6 חודשים" for a punch card ("בתוך" on an offer's card); "לשימוש תוך 3 שבועות" when it has no
 * per-class price.
 */
export function perClassText(product: PublicProduct, within: "תוך" | "בתוך" = "תוך"): string {
  const validity = `${within} ${validityText(product.validDays)}`;
  return product.pricePerClassAgorot === null
    ? `לשימוש ${validity}`
    : `${priceText(product.pricePerClassAgorot)} לשיעור, ${validity}`;
}

const countWords = ["", "", "שני", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה", "עשרה"];

/** What a product includes, for the offer page: the owner's blurb, or "שלושה שיעורים לבחירה מכל המערכת". */
export function includedText(product: PublicProduct): string {
  if (product.blurb) return product.blurb;
  if (product.kind === "membership") return "כניסה לכל השיעורים במערכת";
  const entries = product.entries ?? 0;
  if (entries === 1) return "שיעור אחד לבחירה מכל המערכת";
  return `${countWords[entries] || entries} שיעורים לבחירה מכל המערכת`;
}
