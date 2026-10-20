import { TempoApiError, type Schemas } from "@tempo/api-client";

export type NotificationGroup = Schemas["NotificationGroup"];
export type TemplateChannelName = "inbox" | "push";
export type TemplateField = `${TemplateChannelName}.${"subject" | "body"}`;

export const groupLabels: Record<NotificationGroup, string> = {
  bookings: "הרשמות",
  reminders: "תזכורות",
  studio: "הודעות מהסטודיו",
  celebrations: "חגיגות",
};

/** What each templated kind is about (docs/30 step 7); an unknown kind shows its code. */
const kindLabels: Record<string, string> = {
  "booking.promoted": "התפנה מקום ונרשם מרשימת ההמתנה",
  "booking.promotion_failed": "התפנה מקום, אבל אין כרטיסייה בתוקף",
  "booking.moved": "הועבר לשיעור אחר",
  "session.cancelled": "שיעור בוטל",
  "waitlist.expired": "רשימת ההמתנה נסגרה בלי מקום",
  "pass.frozen": "המנוי הוקפא",
  "reminder.class_tomorrow": "תזכורת ערב לפני שיעור",
  "reminder.class_soon": "תזכורת זמן קצר לפני שיעור",
  "reminder.pass_ending": "המנוי או הכרטיסייה עומדים לפוג",
  "reminder.entries_low": "נשארו מעט כניסות בכרטיסייה",
  "member.milestone": "אבן דרך במספר השיעורים",
  "member.referral_rewarded": "פרס על חבר.ה שהגיע.ה בפעם הראשונה",
};

export const kindLabel = (kind: string) => kindLabels[kind] ?? kind;

/** The closed variable list of docs/30 section 6, in words; the API's list for the kind decides which apply. */
const variableLabels: Record<string, string> = {
  "person.firstName": "השם הפרטי",
  "studio.name": "שם הסטודיו",
  "link.preferences": "קישור להעדפות ההתראות",
  "session.classTypeName": "שם השיעור",
  "session.startsLocal": "מועד השיעור",
  "session.room": "החדר",
  "link.session": "קישור לשיעור",
  "pass.entriesLeft": "כניסות שנשארו",
  "pass.frozenUntil": "ההקפאה עד",
};

export const variableLabel = (name: string) => variableLabels[name] ?? name;

const variablePattern = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Variables in the text that the kind does not offer, as written (without braces). */
export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  const found = Array.from(text.matchAll(variablePattern), (match) => match[1] ?? "");
  return [...new Set(found.filter((name) => !allowed.includes(name)))];
}

const fields: readonly TemplateField[] = ["inbox.subject", "inbox.body", "push.subject", "push.body"];

/**
 * The field and variable of a 400 `template.unknown_variable` (T1 on board #208): `errors[].field` per the Problem
 * schema, else a top-level `field`.
 */
export function unknownVariableError(error: unknown): { field: TemplateField; variable: string | null } | null {
  if (!(error instanceof TempoApiError) || error.code !== "template.unknown_variable") return null;
  const problem = (error.problem ?? {}) as {
    field?: unknown;
    variable?: unknown;
    errors?: { field?: unknown; code?: unknown }[];
  };
  const field = problem.errors?.find((entry) => fields.includes(entry.field as TemplateField))?.field ?? problem.field;
  if (!fields.includes(field as TemplateField)) return null;
  return { field: field as TemplateField, variable: typeof problem.variable === "string" ? problem.variable : null };
}
