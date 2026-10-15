/** The audit actions the API writes, in Hebrew (docs/26 section 8, docs/27 section 7). Unknown ones show as sent. */
const actionLabels: Record<string, string> = {
  "organization.created": "פתיחת הסטודיו",
  "organization.updated": "עדכון הגדרות הסטודיו",
  "organization.suspended": "השעיית הסטודיו",
  "organization.reactivated": "החזרת הסטודיו לפעילות",
  "organization.viewed_by_operator": "צפייה של צוות Tempo",
  "membership.created": "הצטרפות לסטודיו",
  "membership.joined_via_link": "הצטרפות בקישור",
  "membership.role_changed": "שינוי תפקיד",
  "membership.suspended": "השעיה",
  "membership.reactivated": "החזרה לפעילות",
  "membership.removed": "הסרה מהסטודיו",
  "invitation.created": "יצירת הזמנה",
  "invitation.accepted": "קבלת הזמנה",
  "invitation.revoked": "ביטול הזמנה",
  "join_link.rotated": "החלפת קישור ההצטרפות",
  "join_link.disabled": "כיבוי קישור ההצטרפות",
  "person.created": "הוספת אדם",
  "person.updated": "עדכון פרטי אדם",
  "person.archived": "העברת אדם לארכיון",
  "ownership.transfer_started": "הצעה להעברת בעלות",
  "ownership.transfer_cancelled": "ביטול העברת בעלות",
  "ownership.transfer_declined": "דחיית העברת בעלות",
  "ownership.transferred": "העברת בעלות",
};

export function actionLabel(action: string): string {
  return actionLabels[action] ?? action;
}
