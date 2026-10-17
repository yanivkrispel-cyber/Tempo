import { Chip, type ChipTone } from "./Chip";

/** The four states of a health declaration (docs/31 H-3). */
export type HealthDeclarationStatus = "missing" | "signed" | "needs_medical_approval" | "expired";

const statuses: Record<HealthDeclarationStatus, { tone: ChipTone; word: string; short: string }> = {
  missing: { tone: "warning", word: "חסרה הצהרת בריאות", short: "חסרה" },
  signed: { tone: "success", word: "הצהרת בריאות חתומה", short: "חתומה" },
  needs_medical_approval: { tone: "info", word: "ממתינה לאישור רפואי", short: "נדרש אישור" },
  expired: { tone: "danger", word: "הצהרת הבריאות פגה", short: "פגה" },
};

export interface HealthStatusChipProps {
  status: HealthDeclarationStatus;
  /** The one-word form for a roster row; a screen reader still hears "הצהרת בריאות" first. */
  compact?: boolean;
  className?: string;
}

/** A declaration's status as a chip: a word and a tone, never the tone alone. */
export function HealthStatusChip({ status, compact = false, className }: HealthStatusChipProps) {
  const { tone, word, short } = statuses[status];
  return (
    <Chip tone={tone} className={className}>
      {compact ? (
        <>
          <span className="tp-sr-only">הצהרת בריאות: </span>
          {short}
        </>
      ) : (
        word
      )}
    </Chip>
  );
}
