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
  "organization.slug_taken": "הכתובת הזו כבר תפוסה. נסו כתובת אחרת.",
  "organization.creation_limit": "אפשר לפתוח עד 3 סטודיואים לחשבון.",
  "organization.not_found": "הסטודיו לא נמצא, או שאין לך גישה אליו.",
  "permission.denied": "אין לך הרשאה לפעולה הזו.",
  "concurrency.conflict": "מישהו אחר שינה את הנתונים בינתיים. רעננו ונסו שוב.",
  "auth.step_up_required": "לפעולה הזו צריך לאמת שוב את הזהות: התחברו מחדש, ואחר כך נסו שוב.",
  "membership.forbidden_role_change": "אי אפשר לתת את התפקיד הזה לחבר הזה.",
  "role.exceeds_actor": "אפשר לתת רק תפקיד נמוך מהתפקיד שלך.",
  "ownership.transfer_pending": "כבר יש הצעה להעברת הבעלות שממתינה לתשובה.",
  "ownership.target_not_admin": "אפשר להעביר את הבעלות רק למנהל פעיל.",
  "ownership.transfer_not_found": "ההצעה כבר לא בתוקף.",
  "ownership.transfer_expired": "פג התוקף של ההצעה.",
  "ownership.transfer_stale": "התפקידים בסטודיו השתנו מאז ההצעה, ולכן היא בוטלה.",
  "auth.mfa_required": "כדי לנהל את הסטודיו צריך להפעיל בחשבון אימות דו־שלבי.",
  "person.read_only": "הרשומה הזו כבר לא ניתנת לשינוי (נמחקה או אוחדה).",
  "person.erase_self": "אי אפשר למחוק את הנתונים שלך מכאן.",
  "person.merge_both_have_login": "לשתי הרשומות יש חשבון, ולכן אלה שני אנשים שונים.",
  "relationship.exists": "הקשר הזה כבר רשום.",
  "relationship.self": "אי אפשר לקשר אדם לעצמו.",
  "consent.invalid": "הבחירה לא תקינה. בדקו את המטרה, הערוץ והגרסה."
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
