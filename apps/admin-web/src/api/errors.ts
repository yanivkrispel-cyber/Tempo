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
  "billing.restricted":
    "המנוי של הסטודיו מושהה, ולכן אי אפשר להוסיף או לשנות דבר. אפשר עדיין לצפות, לייצא, לבטל הזמנות ולהסיר חברים.",
  "person.read_only": "הרשומה הזו כבר לא ניתנת לשינוי (נמחקה או אוחדה).",
  "person.erase_self": "אי אפשר למחוק את הנתונים שלך מכאן.",
  "person.has_login": "לאדם הזה כבר יש חשבון באפליקציה.",
  "person.merge_both_have_login": "לשתי הרשומות יש חשבון, ולכן אלה שני אנשים שונים.",
  "relationship.exists": "הקשר הזה כבר רשום.",
  "relationship.self": "אי אפשר לקשר אדם לעצמו.",
  "consent.invalid": "הבחירה לא תקינה. בדקו את המטרה, הערוץ והגרסה.",
  // Scheduling and passes (docs/29 section 9).
  "person.not_found": "האדם לא נמצא.",
  "room.not_found": "החדר לא נמצא.",
  "room.invalid": "בחרו חדר פעיל.",
  "class_type.not_found": "סוג השיעור לא נמצא.",
  "class_type.invalid": "בחרו סוג שיעור פעיל.",
  "instructor.invalid": "בחרו מדריך או מדריכה פעילים מהצוות.",
  "template.not_found": "השיעור הקבוע לא נמצא. ייתכן שמישהו אחר שינה אותו.",
  "template.invalid": "פרטי השיעור הקבוע לא תקינים.",
  "session.not_found": "השיעור לא נמצא.",
  "session.cancelled": "השיעור כבר בוטל.",
  "session.full": "השיעור מלא.",
  "session.capacity_below_booked": "אי אפשר להוריד את מספר המקומות אל מתחת למספר הרשומים.",
  "localDate.invalid": "אפשר להוסיף רק שיעור שעוד לא התחיל.",
  "validUntil.invalid": "תאריך הסיום צריך להיות ביום הפתיחה של השיעור הקבוע או אחריו.",
  "capacity.invalid": "מספר המקומות צריך להיות בין 1 ל־500.",
  "minutes.invalid": "משך השיעור צריך להיות בין 10 ל־300 דקות.",
  "category.invalid": "בחרו קטגוריה מהרשימה.",
  "booking.not_found": "ההרשמה לא נמצאה.",
  "booking.duplicate": "האדם הזה כבר רשום לשיעור או ממתין לו.",
  "booking.closed": "השיעור כבר התחיל, ההרשמה סגורה.",
  "booking.not_open": "ההרשמה לשיעור הזה עוד לא נפתחה.",
  "booking.no_valid_pass": "אין כרטיסייה או מנוי בתוקף לשיעור הזה.",
  "booking.not_cancellable": "אי אפשר לבטל את ההרשמה הזו.",
  "attendance.out_of_window": "אפשר לסמן נוכחות מחצי שעה לפני השיעור ועד שבוע אחריו.",
  "pass_product.not_found": "המוצר לא נמצא.",
  "pass_product.invalid": "בחרו אחד מהמוצרים של הסטודיו.",
  "pass_product.archived": "המוצר הזה כבר לא נמכר. בחרו מוצר פעיל.",
  "pass_product.in_use": "כבר יש כרטיסיות או מנויים מהמוצר הזה, ולכן אי אפשר לשנות אותו.",
  "entries.invalid": "בכרטיסייה יש בין 1 ל־200 כניסות.",
  "validDays.invalid": "התוקף צריך להיות בין 1 ל־730 ימים.",
  "weeklyCap.invalid": "המכסה השבועית צריכה להיות בין 1 ל־14 שיעורים.",
  "pass.not_found": "הכרטיסייה או המנוי לא נמצאו.",
  "pass.voided": "הכרטיסייה או המנוי כבר בוטלו.",
  // Freezing a membership (docs/29 section 16.4).
  "pass.not_freezable": "אפשר להקפיא רק מנוי לתקופה. כרטיסייה לא מוקפאת.",
  "pass.freeze_overlap": "הימים האלה חופפים להקפאה אחרת של המנוי.",
  "pass.freeze_outside": "ההקפאה צריכה להתחיל לפני שהמנוי נגמר.",
  "pass.freeze_started": "ההקפאה כבר התחילה, ואי אפשר להסיר אותה.",
  "pass.freeze_not_found": "ההקפאה לא נמצאה. ייתכן שהוסרה כבר.",
  "startsOn.invalid": "ההקפאה מתחילה היום או אחר כך.",
  "endsOn.invalid": "ההקפאה נמשכת בין יום אחד ל־90 ימים.",
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

/** A 404 of any kind: the resource's own code (`session.not_found`) or the gateway's plain one. */
export function isNotFound(error: unknown): boolean {
  return error instanceof TempoApiError && error.status === 404;
}
