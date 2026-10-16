import type { Schemas } from "@tempo/api-client";
import type { ChipTone } from "../../shared/design-system";

export const personStatus: Record<Schemas["PersonStatus"], { text: string; tone: ChipTone }> = {
  active: { text: "פעיל", tone: "success" },
  archived: { text: "בארכיון", tone: "neutral" },
  anonymized: { text: "נמחק", tone: "danger" },
  merged: { text: "אוחד", tone: "neutral" },
};

export const sourceLabel: Record<Schemas["PersonSource"], string> = {
  organization_created: "פתיחת הסטודיו",
  join_link: "קישור הצטרפות",
  invitation: "הזמנה",
  staff_created: "הוספה בסטודיו",
  import: "ייבוא",
};
