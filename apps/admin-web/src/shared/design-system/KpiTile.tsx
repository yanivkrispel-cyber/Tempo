import { Card } from "./Card";
import { cx } from "./cx";
import { Icon } from "./Icon";

export interface KpiChange {
  /** The difference against the previous period, in the value's own unit (a percentage point for a rate). */
  delta: number;
  /** Shown after the number: "%" for a rate, nothing for a count. */
  unit?: "%" | "";
}

export interface KpiTileProps {
  label: string;
  /** Already formatted (a count, or "82%"). */
  value: string;
  /** Left out when the previous period has no figure to compare with. */
  change?: KpiChange | null;
  /** Which direction is good news; a rising no-show count is not. */
  goodWhen?: "up" | "down";
  /** How the comparison is named, after the change. */
  comparedTo?: string;
  /** What to say when `change` is null; by default, that there is no previous period. */
  noChange?: string;
}

function formatDelta(delta: number, unit: "%" | "") {
  const abs = Math.abs(delta);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${text}${unit}`;
}

/**
 * A report figure (docs/32 R-3). The change is written in words with an arrow, never as a signed number
 * (a minus flips in RTL) and never by hue alone.
 */
export function KpiTile({
  label,
  value,
  change,
  goodWhen = "up",
  comparedTo = "לעומת התקופה הקודמת",
  noChange = "אין תקופה קודמת להשוואה",
}: KpiTileProps) {
  let changeLine;
  if (!change) {
    changeLine = <p className="tp-kpi__change">{noChange}</p>;
  } else if (change.delta === 0) {
    changeLine = <p className="tp-kpi__change">ללא שינוי {comparedTo}</p>;
  } else {
    const up = change.delta > 0;
    const good = up === (goodWhen === "up");
    changeLine = (
      <p className={cx("tp-kpi__change", good ? "tp-kpi__change--good" : "tp-kpi__change--bad")}>
        <Icon name={up ? "arrow-up" : "arrow-down"} />
        <span>
          {up ? "עלייה של " : "ירידה של "}
          <bdi>{formatDelta(change.delta, change.unit ?? "")}</bdi> {comparedTo}
        </span>
      </p>
    );
  }
  return (
    <Card small className="tp-kpi">
      <p className="tp-kpi__label">{label}</p>
      <p className="tp-kpi__value">
        <bdi>{value}</bdi>
      </p>
      {changeLine}
    </Card>
  );
}
