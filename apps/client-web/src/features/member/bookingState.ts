// What a session and a booking mean for the member, in words. The API is the source of truth; the one rule kept
// here is docs/29 section 11: the worker closes waitlists once a day, so a waitlist place in a session that has
// started is shown as expired, never as "waiting".
import type { ChipTone } from "../../shared/design-system";
import { formatDate } from "../../shared/utilities/dates";
import type { Booking, BookingPolicy, Pass, PassSummary, Session } from "./studio";
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

/** "כרטיסיית 10 · נשארו 7 כניסות" or "מנוי חודשי · בתוקף עד 12.11.2026". */
export function passLine(pass: PassSummary): string {
  return pass.kind === "punch_card" && pass.entriesLeft != null
    ? `${pass.name} · ${entriesText(pass.entriesLeft)}`
    : `${pass.name} · בתוקף עד ${formatDate(pass.endsOn)}`;
}

/** What booking will take from the pass the server would pick. */
export function passUseText(pass: PassSummary): string {
  if (pass.kind === "punch_card" && pass.entriesLeft != null) {
    const after = pass.entriesLeft - 1;
    return `תנוצל כניסה אחת מ${pass.name}. ${after === 0 ? "זו הכניסה האחרונה בכרטיסייה." : `אחרי ההרשמה ${entriesText(after)}.`}`;
  }
  return `כלול ב${pass.name}, בתוקף עד ${formatDate(pass.endsOn)}.`;
}

/** What a booking took, for the confirmation: "בכרטיסיית 10 נשארו 6 כניסות." */
export function passTakenText(pass: PassSummary | null | undefined): string {
  if (!pass) return "";
  if (pass.kind === "punch_card" && pass.entriesLeft != null) {
    return pass.entriesLeft === 0
      ? `זו הייתה הכניסה האחרונה ב${pass.name}.`
      : `ב${pass.name} ${entriesText(pass.entriesLeft)}.`;
  }
  return `נוצל ${pass.name}.`;
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

/** Whether a full session still takes waitlist places (docs/29 section 6.1: enabled, and before the cutoff). */
export function waitlistOpen(session: Session, policy: BookingPolicy | undefined, now: Date): boolean {
  if (policy && !policy.waitlistEnabled) return false;
  const cutoffHours = policy?.waitlistCutoffHours ?? 2;
  return now.getTime() < new Date(session.startsAt).getTime() - cutoffHours * 3_600_000;
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
      if (booking.cancelReason === "no_valid_pass") return { label: "יצאת מההמתנה · אין כרטיסייה", tone: "warning" };
      // A place left on the waitlist reads the same as a cancel in time: the API does not say which it was.
      return booking.lateCancel
        ? { label: "בוטל באיחור · הכניסה נוצלה", tone: "warning" }
        : { label: "בוטל בזמן", tone: "neutral", plain: true };
    default:
      return { label: "לא ידוע", tone: "neutral", plain: true };
  }
}
