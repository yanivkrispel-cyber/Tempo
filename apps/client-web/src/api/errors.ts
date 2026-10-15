import { TempoApiError } from "@tempo/api-client";

/** Messages for the Problem codes a member can meet (contract, `components.responses`). */
const messages: Record<string, string> = {
  "account.disabled": "החשבון הזה הושבת. לפרטים פנו לסטודיו.",
  "account.email_not_verified": "צריך לאמת את כתובת המייל לפני שממשיכים. חפשו את קוד האימות בתיבת המייל.",
  "membership.suspended": "החברות שלך בסטודיו מושעית. לפרטים פנו לסטודיו.",
  "organization.suspended": "הסטודיו לא פעיל כרגע.",
  "invitation.not_found": "ההזמנה לא נמצאה. ייתכן שפג תוקפה או שבוטלה. בקשו מהסטודיו הזמנה חדשה.",
  "invitation.expired": "פג התוקף של ההזמנה. בקשו מהסטודיו הזמנה חדשה.",
  "invitation.email_mismatch": "ההזמנה נשלחה לכתובת מייל אחרת. התחברו עם הכתובת שאליה נשלחה.",
  // Booking and the waitlist (docs/29 section 9).
  "session.not_found": "השיעור לא נמצא. ייתכן שהוסר מהמערכת.",
  "session.full": "השיעור מלא ורשימת ההמתנה שלו סגורה.",
  "session.cancelled": "הסטודיו ביטל את השיעור הזה.",
  "booking.not_found": "ההרשמה לא נמצאה. ייתכן שכבר בוטלה.",
  "booking.duplicate": "כבר נרשמתם לשיעור הזה, או שאתם ברשימת ההמתנה שלו.",
  "booking.closed": "השיעור כבר התחיל, ואי אפשר להירשם אליו.",
  "booking.not_open": "ההרשמה לשיעור הזה עוד לא נפתחה.",
  "booking.no_valid_pass": "אין כרטיסייה בתוקף, פנו לסטודיו.",
  "booking.not_cancellable": "אי אפשר לבטל את ההרשמה הזו. ייתכן שהשיעור כבר התחיל.",
  "person.not_found": "לא מצאנו את הרשומה שלך בסטודיו. פנו לסטודיו.",
  "person.read_only": "הרשומה שלך בסטודיו לא פעילה. פנו לסטודיו.",
  "permission.denied": "אין לך הרשאה לפעולה הזו.",
  "billing.restricted": "הסטודיו לא מקבל הרשמות כרגע. לפרטים פנו לסטודיו.",
};

/** A sentence for the person in front of the screen; never the server's English text. */
export function errorMessage(error: unknown, fallback = "משהו השתבש. נסו שוב."): string {
  if (!(error instanceof TempoApiError)) return "אין חיבור לשרת. בדקו את החיבור ונסו שוב.";
  if (error.status === 429) {
    const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
    return minutes === 1 ? "יותר מדי ניסיונות. נסו שוב בעוד דקה." : `יותר מדי ניסיונות. נסו שוב בעוד ${minutes} דקות.`;
  }
  return messages[error.code] ?? fallback;
}

export function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof TempoApiError && codes.includes(error.code);
}
