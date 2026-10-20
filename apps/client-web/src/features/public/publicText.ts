import type { ChipTone } from "../../shared/design-system";
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { shortDayName } from "../member/format";
import { clockTime, hasStarted, studioDate } from "../member/studioTime";
import type { PublicSession } from "./publicStudio";

/** "₪45", or "₪45.50"; the price is paid at the studio (SL-5). */
export function shekels(agorot: number): string {
  const amount = agorot / 100;
  return `₪${amount.toLocaleString("he-IL", { minimumFractionDigits: agorot % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The intro offer as one line: "שיעור ניסיון · ₪45", or its name alone when it has no price. */
export function offerText({ name, priceAgorot }: { name: string; priceAgorot: number | null }): string {
  return priceAgorot === null ? name : `${name} · ${shekels(priceAgorot)}`;
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
