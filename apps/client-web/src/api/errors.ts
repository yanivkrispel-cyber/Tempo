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
  "booking.no_valid_pass":
    "אין כרטיסייה או מנוי בתוקף לשיעור הזה. אם המנוי מוקפא, אי אפשר להירשם בימי ההקפאה. פנו לסטודיו.",
  "booking.not_cancellable": "אי אפשר לבטל את ההרשמה הזו. ייתכן שהשיעור כבר התחיל.",
  "person.not_found": "לא מצאנו את הרשומה שלך בסטודיו. פנו לסטודיו.",
  "person.read_only": "הרשומה שלך בסטודיו לא פעילה. פנו לסטודיו.",
  // Deleting the login (docs/32 section 9).
  "auth.step_up_required": "לפעולה הזו צריך לאמת שוב את הזהות: התחברו מחדש, ואחר כך נסו שוב.",
  "account.confirmation_mismatch": "כתובת המייל לא תואמת לחשבון. כתבו אותה בדיוק כפי שהיא מופיעה.",
  "permission.denied": "אין לך הרשאה לפעולה הזו.",
  "auth.mfa_required":
    "לחשבון שלך יש תפקיד ניהול בסטודיו, ולכן צריך להפעיל בו אימות דו־שלבי. הפעילו אותו במסוף הניהול, בעמוד אבטחת החשבון, ואז חזרו לכאן.",
  // Notification preferences (docs/30 section 7).
  "preferences.inbox_required": "תיבת ההודעות באפליקציה תמיד פעילה, ואי אפשר לכבות אותה.",
  "quietHours.invalid": "שעת הסיום של השעות השקטות צריכה להיות שונה משעת ההתחלה.",
  // The health declaration (docs/31 section 9).
  "health.declaration_required": "הסטודיו מבקש הצהרת בריאות חתומה לפני ההרשמה לשיעורים. אפשר למלא אותה עכשיו, בפרופיל.",
  "health.form_version_stale": "הטופס עודכן בינתיים. עברו על השאלות שוב וחתמו.",
  "health.answers_incomplete": "צריך לענות על כל השאלות.",
  "health.confirmation_required": "צריך לאשר לפני החתימה.",
  "health.signed_name_invalid": "צריך לכתוב שם מלא, בין 2 ל-100 תווים.",
  "health.guardian_name_required": "צריך לכתוב את השם המלא של ההורה או האפוטרופוס.",
  "health.key_unavailable": "אי אפשר לשמור את ההצהרה כרגע. נסו שוב בעוד כמה דקות.",
  "join.closed": "הסטודיו מצרף מתאמנים בהזמנה בלבד. בקשו מהסטודיו קישור הצטרפות.",
  "billing.restricted": "ההרשמה לשיעורים בסטודיו מושהית כרגע. אפשר עדיין לראות ולבטל הזמנות קיימות.",
};

/** The sentence for a Problem code, when the app has one. */
export function codeMessage(code: string): string | undefined {
  return messages[code];
}

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
