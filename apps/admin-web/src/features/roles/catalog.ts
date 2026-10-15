import type { Schemas } from "@tempo/api-client";

/**
 * The four system roles' fixed ids (migration 0005, docs/27 section 3.2). Phase 2 has no custom roles (A-1), so the
 * role editor can name a role without asking the API first.
 */
export const systemRoleIds: Record<Schemas["Role"], string> = {
  owner: "00000000-0000-7000-8000-000000000001",
  admin: "00000000-0000-7000-8000-000000000002",
  staff: "00000000-0000-7000-8000-000000000003",
  client: "00000000-0000-7000-8000-000000000004"
};

/** What each permission allows, in Hebrew (docs/27 section 3.1). Keys the app does not know show as they are. */
const permissionLabels: Record<string, string> = {
  "organization.view": "צפייה בפרטי הסטודיו",
  "organization.settings.manage": "עריכת הגדרות הסטודיו",
  "members.view": "צפייה ברשימת החברים",
  "members.invite.staff": "הזמנת צוות ומתאמנים, וניהול קישור ההצטרפות",
  "members.invite.admin": "הזמנת מנהלים",
  "members.manage": "השעיה, הסרה ושינוי תפקיד של חברים בתפקיד נמוך יותר",
  "roles.manage": "ניהול תפקידים",
  "audit.view": "צפייה ביומן הפעולות",
  "people.view": "צפייה באנשים",
  "people.manage": "הוספה ועריכה של אנשים ופרטי קשר",
  "people.merge": "איחוד רשומות כפולות",
  "people.export": "ייצוא הנתונים של אדם",
  "people.erase": "מחיקת הנתונים של אדם",
  "consent.manage": "רישום הסכמות בשם אחרים",
  "ownership.transfer": "העברת הבעלות על הסטודיו"
};

export function permissionLabel(key: string): string {
  return permissionLabels[key] ?? key;
}
