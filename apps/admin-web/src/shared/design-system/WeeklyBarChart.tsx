import { useId } from "react";
import { cx } from "./cx";

export interface WeeklyBar {
  /** Stable key, such as the week's first day (ISO date). */
  key: string;
  /** The short label under the bar, such as "4.10". */
  label: string;
  /** The week named in full for the table, such as "השבוע של 4.10". */
  longLabel?: string;
  value: number;
}

export interface WeeklyBarChartProps {
  /** The figure's caption, which also names the series (one series, so no legend). */
  title: string;
  weeks: WeeklyBar[];
  /** The column header of the values in the table, such as "ביקורים". */
  valueLabel: string;
  /** Formats a value for the labels and the table; whole numbers by default. */
  format?: (value: number) => string;
  /** Whole counts (the default) never get a tick between two whole numbers. */
  whole?: boolean;
  /** Shows the table on screen under the chart, not only to screen readers. */
  showTable?: boolean;
  emptyText?: string;
  className?: string;
}

const width = 320;
const height = 168;
const top = 18;
const bottom = 22;
const start = 28;
const plotHeight = height - top - bottom;
const radius = 4;

/**
 * The axis for values up to `max`: a step of 1, 2 or 5 times a power of ten (at least 1 for whole counts) that
 * reaches `max` in at most `count` steps, and the ticks at each whole step, so no two ticks share a label.
 */
export function niceScale(max: number, { count = 2, whole = true } = {}): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const step = whole ? Math.max(1, nice) : nice;
  const top = Math.ceil(max / step) * step;
  return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step) };
}

/** The top of the axis for values up to `max` (niceScale's). */
export function niceMax(max: number, count = 2) {
  return niceScale(max, { count }).max;
}

/** A bar with rounded top corners, anchored square on the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(radius, w / 2, h);
  const base = y + h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/**
 * One series of weekly totals (docs/32 R-3). The plot runs oldest week first, left to right, in a dir="ltr"
 * box; the figures are also a table, read by screen readers instead of the drawing.
 */
export function WeeklyBarChart({
  title,
  weeks,
  valueLabel,
  format = (value) => String(Math.round(value)),
  whole = true,
  showTable = false,
  emptyText = "אין נתונים בתקופה הזאת",
  className,
}: WeeklyBarChartProps) {
  const captionId = useId();
  if (weeks.length === 0) {
    return (
      <figure className={cx("tp-bars", className)} aria-labelledby={captionId}>
        <figcaption id={captionId} className="tp-bars__caption">
          {title}
        </figcaption>
        <p className="tp-bars__empty">{emptyText}</p>
      </figure>
    );
  }

  const { max, ticks } = niceScale(Math.max(...weeks.map((week) => week.value)), { whole });
  const band = (width - start) / weeks.length;
  const barWidth = Math.max(4, Math.min(24, band * 0.6));
  const y = (value: number) => top + plotHeight - (Math.max(0, value) / max) * plotHeight;
  // Every week is labelled while there is room; past eight, every other one (the latest always).
  const labelEvery = weeks.length > 8 ? 2 : 1;

  return (
    <figure className={cx("tp-bars", className)} aria-labelledby={captionId}>
      <figcaption id={captionId} className="tp-bars__caption">
        {title}
      </figcaption>
      <div className="tp-bars__plot" dir="ltr" aria-hidden="true">
        <svg viewBox={`0 0 ${width} ${height}`} focusable="false">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "tp-bars__axis" : "tp-bars__grid"}
                x1={start}
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="tp-bars__tick" x={start - 6} y={y(tick)} dy="0.32em" textAnchor="end">
                {format(tick)}
              </text>
            </g>
          ))}
          {weeks.map((week, index) => {
            const center = start + band * index + band / 2;
            const latest = index === weeks.length - 1;
            const showTick = latest || (weeks.length - 1 - index) % labelEvery === 0;
            const barTop = y(week.value);
            return (
              <g key={week.key} className={cx("tp-bars__col", latest && "tp-bars__col--latest")}>
                <title>{`${week.longLabel ?? week.label}: ${format(week.value)}`}</title>
                <rect className="tp-bars__hit" x={center - band / 2} y={top} width={band} height={plotHeight} />
                {week.value > 0 && (
                  <path
                    className="tp-bars__bar"
                    d={barPath(center - barWidth / 2, barTop, barWidth, top + plotHeight - barTop)}
                  />
                )}
                <text className="tp-bars__value" x={center} y={barTop - 5} textAnchor="middle">
                  {format(week.value)}
                </text>
                {showTick && (
                  <text className="tp-bars__tick" x={center} y={height - 6} textAnchor="middle" direction="rtl">
                    {week.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <table className={cx("tp-table", "tp-table--compact", !showTable && "tp-sr-only")}>
        <caption className="tp-sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col">שבוע</th>
            <th scope="col" className="tp-num">
              {valueLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.key}>
              <th scope="row">{week.longLabel ?? week.label}</th>
              <td className="tp-num">
                <bdi>{format(week.value)}</bdi>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
