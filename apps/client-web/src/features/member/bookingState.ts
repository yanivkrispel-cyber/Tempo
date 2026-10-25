// What a session and a booking mean for the member, in words. The API is the source of truth; the one rule kept
// here is docs/29 section 11: the worker closes waitlists once a day, so a waitlist place in a session that has
// started is shown as expired, never as "waiting".
import type { ChipTone } from "../../shared/design-system";
import type { Booking, BookingPolicy, Pass, Session } from "./studio";
import { hasStarted } from "./studioTime";

export type MyState = "none" | "booked" | "waitlisted" | "expired" | "attended" | "no_show";

/** The caller's place in a session, with a started session's waitlist place read as expired. */
export function myState(session: Session, now: Date): MyState {
  const status = session.myBooking?.status;
  if (!status) return "none";
  if (status === "waitlisted" && hasStarted(session.startsAt, now)) return "expired";
  if (status === "booked" || status === "waitlisted" || status === "attended" || status === "no_show") return status;
  return status === "expired" ? "expired" : "none";
}

export function freeSpots(session: Session): number {
  return Math.max(session.capacity - session.bookedCount, 0);
}

/**
 * The room map's caption: "5 פנויים מתוך 12". The room may have more devices than the class has places, and a desk
 * booking takes a place without a device, so the free count is capped by the class's free places and the total by
 * its capacity (#503).
 */
export function deviceCountText(session: Session, spots: readonly { state: string }[]): string {
  const free = Math.min(spots.filter((spot) => spot.state === "free").length, freeSpots(session));
  return `${free} פנויים מתוך ${Math.min(spots.length, session.capacity)}`;
}

/** "נשארו 3 מקומות", "נשאר מקום אחד", "מלא · 2 בהמתנה". */
export function spotsText(session: Session): string {
  const free = freeSpots(session);
  if (free === 0) return session.waitlistCount === 0 ? "מלא" : `מלא · ${session.waitlistCount} בהמתנה`;
  return free === 1 ? "נשאר מקום אחד" : `נשארו ${free} מקומות`;
}

/** "במקום 2 בהמתנה", or without the number when the API has none. */
export function waitText(position: number | null | undefined): string {
  return position ? `במקום ${position} בהמתנה` : "ברשימת ההמתנה";
}

export function entriesText(left: number): string {
  if (left === 0) return "לא נשארו כניסות";
  return left === 1 ? "נשארה כניסה אחת" : `נשארו ${left} כניסות`;
}

/** Passes the member can still use: not voided, not past their end date. */
export function livePasses(passes: readonly Pass[]): Pass[] {
  return passes.filter((pass) => pass.status === "active");
}

export const noPassText = "אין כרטיסייה בתוקף, פנו לסטודיו.";

/** The free-cancellation deadline: the server's, else from the studio's policy; null when neither is known. */
export function freeCancelDeadline(session: Session, policy: BookingPolicy | undefined): Date | null {
  if (session.myBooking?.freeCancelUntil) return new Date(session.myBooking.freeCancelUntil);
  if (!policy) return null;
  return new Date(new Date(session.startsAt).getTime() - policy.freeCancelHours * 3_600_000);
}

/** The last moment a place can still open from the waitlist: the start minus the cutoff (2 hours by default). */
export function waitlistCutoff(session: Session, policy: BookingPolicy | undefined): Date {
  return new Date(new Date(session.startsAt).getTime() - (policy?.waitlistCutoffHours ?? 2) * 3_600_000);
}

/** Whether a full session still takes waitlist places (docs/29 section 6.1: enabled, and before the cutoff). */
export function waitlistOpen(session: Session, policy: BookingPolicy | undefined, now: Date): boolean {
  if (policy && !policy.waitlistEnabled) return false;
  return now.getTime() < waitlistCutoff(session, policy).getTime();
}

// The category is a slug ("pilates"); the common ones have a Hebrew name, the rest borrow a class type's name.
const categoryNames: Record<string, string> = {
  pilates: "פילאטיס",
  yoga: "יוגה",
  barre: "בר",
  fitness: "כושר",
  strength: "כוח",
  dance: "מחול",
  meditation: "מדיטציה",
};

export function categoryName(category: string, sessions: readonly Session[]): string {
  return (
    categoryNames[category] ??
    sessions.find((session) => session.classType.category === category)?.classType.name ??
    category
  );
}

/** The history row's status for a past or cancelled booking. */
export function pastStatus(
  booking: Booking,
  session: Session,
  now: Date,
): { label: string; tone: ChipTone; plain?: boolean } {
  switch (booking.status) {
    case "attended":
      return { label: "הגעת", tone: "success" };
    case "booked":
      // An unmarked booking after the class counts as attended (docs/29 C-3).
      return hasStarted(session.startsAt, now)
        ? { label: "התקיים", tone: "success" }
        : { label: "נרשמת", tone: "success" };
    case "no_show":
      return { label: "לא הגעת · הכניסה נוצלה", tone: "warning" };
    case "waitlisted":
    case "expired":
      return { label: "לא התפנה מקום", tone: "neutral", plain: true };
    case "removed":
      return { label: "הוסרת מהשיעור", tone: "neutral", plain: true };
    case "cancelled":
      if (booking.cancelReason === "session_cancelled") return { label: "השיעור בוטל", tone: "neutral", plain: true };
      if (booking.cancelReason === "moved") return { label: "הועבר לשיעור אחר", tone: "neutral", plain: true };
      if (booking.cancelReason === "no_valid_pass") return { label: "יצאת מההמתנה · אין כרטיסייה", tone: "warning" };
      // A place left on the waitlist reads the same as a cancel in time: the API does not say which it was.
      return booking.lateCancel
        ? { label: "בוטל באיחור · הכניסה נוצלה", tone: "warning" }
        : { label: "בוטל בזמן", tone: "neutral", plain: true };
    default:
      return { label: "לא ידוע", tone: "neutral", plain: true };
  }
}
