import type { ChipTone } from "../../shared/design-system";
import type { IsoDate } from "../../shared/utilities/dates";
import { hasStarted, momentText } from "../member/studioTime";
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

/** "מחר 18:00 · 55 דק׳". */
export function whenText(session: PublicSession, timeZone: string, today: IsoDate): string {
  return `${momentText(session.startsAt, timeZone, today)} · ${session.minutes} דק׳`;
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
